const BaseService = require('../../utils/baseService.cjs');
const logger = require('../../utils/logger.cjs');
const { createError, ERROR_CODES } = require('../../utils/errors.cjs');
const { stripe } = require('../../config/stripeConfig.cjs');

class PaymentSecurity extends BaseService {
    constructor() {
        super('payment-security');
        this.rateLimits = new Map();
        this.failedAttempts = new Map();
        this.config = {
            maxAttempts: 5,
            blockDuration: 30 * 60 * 1000, // 30 minutes
            rateLimits: {
                api: 3,     // 3 requests per minute
                idempotency: 3  // 3 attempts per key
            }
        };
        this.logger = logger.child({
            context: 'payment',
            service: 'security'
        });
    }

    async _init() {
        // Start cleanup job
        this.cleanupInterval = setInterval(() => {
            this.cleanupRateLimits();
        }, 5 * 60 * 1000); // Every 5 minutes

        this.logger.info('Payment security service initialized', {
            config: this.config
        });
    }

    async validateSignature(payload, signature) {
        try {
            if (!process.env.STRIPE_WEBHOOK_SECRET) {
                throw new Error('Stripe webhook secret not configured');
            }

            const event = stripe.webhooks.constructEvent(
                payload,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );

            this.logger.debug('Webhook signature validated', {
                type: event.type,
                id: event.id
            });

            return event;
        } catch (error) {
            this.logger.error('Webhook signature validation failed:', {
                error: error.message,
                type: error.type
            });
            throw createError.validation(
                ERROR_CODES.INVALID_SIGNATURE,
                'Invalid webhook signature'
            );
        }
    }

    async validateAmount(amount, context) {
        try {
            if (!amount || amount <= 0) {
                throw createError.validation(
                    ERROR_CODES.INVALID_AMOUNT,
                    'Invalid payment amount'
                );
            }

            // Check for suspicious amounts
            if (amount > 100000) { // $1000
                this.logger.warn('Large payment amount detected', {
                    amount,
                    context
                });
                // Additional verification may be required
            }

            return true;
        } catch (error) {
            this.logger.error('Amount validation failed:', {
                error: error.message,
                amount,
                context
            });
            throw error;
        }
    }

    async validateMetadata(metadata) {
        try {
            if (!metadata) {
                throw createError.validation(
                    ERROR_CODES.MISSING_METADATA,
                    'Payment metadata is required'
                );
            }

            const requiredFields = ['userId', 'type'];
            const missingFields = requiredFields.filter(field => !metadata[field]);

            if (missingFields.length > 0) {
                throw createError.validation(
                    ERROR_CODES.MISSING_REQUIRED_FIELD,
                    `Missing required metadata fields: ${missingFields.join(', ')}`
                );
            }

            return true;
        } catch (error) {
            this.logger.error('Metadata validation failed:', {
                error: error.message,
                metadata
            });
            throw error;
        }
    }

    async checkRateLimit(key, type = 'api') {
        const rateKey = `${type}:${key}`;
        const now = Date.now();
        const windowMs = 60 * 1000; // 1 minute window

        let attempts = this.rateLimits.get(rateKey) || [];
        attempts = attempts.filter(time => now - time < windowMs);

        if (attempts.length >= this.config.rateLimits[type]) {
            this.logger.warn('Rate limit exceeded', {
                key,
                type,
                attempts: attempts.length,
                limit: this.config.rateLimits[type]
            });

            throw createError.rateLimit(
                ERROR_CODES.RATE_LIMIT_EXCEEDED,
                'Rate limit exceeded for payment operations'
            );
        }

        attempts.push(now);
        this.rateLimits.set(rateKey, attempts);

        return true;
    }

    async trackFailedAttempt(key) {
        const attempts = (this.failedAttempts.get(key) || 0) + 1;
        this.failedAttempts.set(key, attempts);

        if (attempts >= this.config.maxAttempts) {
            this.logger.error('Maximum failed attempts reached', {
                key,
                attempts,
                blockDuration: this.config.blockDuration
            });

            // Block for configured duration
            setTimeout(() => {
                this.failedAttempts.delete(key);
            }, this.config.blockDuration);

            throw createError.rateLimit(
                ERROR_CODES.MAX_ATTEMPTS_EXCEEDED,
                'Maximum payment attempts exceeded'
            );
        }

        return attempts;
    }

    cleanupRateLimits() {
        const now = Date.now();
        const windowMs = 60 * 1000;

        for (const [key, attempts] of this.rateLimits.entries()) {
            const validAttempts = attempts.filter(time => now - time < windowMs);
            if (validAttempts.length === 0) {
                this.rateLimits.delete(key);
            } else {
                this.rateLimits.set(key, validAttempts);
            }
        }

        this.logger.debug('Rate limits cleaned up', {
            activeKeys: this.rateLimits.size,
            failedAttempts: this.failedAttempts.size
        });
    }

    async _cleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.rateLimits.clear();
        this.failedAttempts.clear();
        this.logger.info('Payment security service cleaned up');
    }

    getHealth() {
        return {
            status: 'healthy',
            rateLimits: {
                activeRateLimits: this.rateLimits.size,
                failedAttempts: this.failedAttempts.size
            },
            config: {
                maxAttempts: this.config.maxAttempts,
                blockDuration: this.config.blockDuration,
                rateLimits: this.config.rateLimits
            }
        };
    }
}

module.exports = new PaymentSecurity(); 