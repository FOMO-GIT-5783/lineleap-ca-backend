const BaseService = require('../../utils/baseService.cjs');
const logger = require('../../utils/logger.cjs');
const { createError, ERROR_CODES } = require('../../utils/errors.cjs');
const { stripe } = require('../../config/stripeConfig.cjs');
const VenueAwareBreaker = require('../../utils/circuitBreaker.cjs');
const redisClient = require('../../utils/redisClient.cjs');
const mongoose = require('mongoose');
const OrderLock = require('../../models/OrderLock.cjs');
const EVENT_TYPES = require('../../utils/eventTypes.cjs');

// Keep existing transaction states
const TX_STATES = {
    INITIATED: 'initiated',
    PAYMENT_PENDING: 'payment_pending',
    PAYMENT_COMPLETED: 'payment_completed',
    ORDER_PENDING: 'order_pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    ROLLBACK: 'rollback',
    VALIDATION_FAILED: 'validation_failed',
    SECURITY_CHECK_FAILED: 'security_check_failed'
};

// Maintain singleton pattern
let instance = null;

class PaymentProcessor extends BaseService {
    constructor() {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('payment-processor');
        this.stripeConnected = false;
        this.features = new Map();
        this.metrics = {
            attempts: 0,
            success: 0,
            failed: 0,
            latencies: []
        };

        instance = this;
    }

    async _init() {
        try {
            // Verify Stripe connection
            await this.verifyStripeConnection();

            // Initialize features
            await this.initializeFeatures();

            // Set up event handlers
            const events = this.getDependency('events');
            if (events) {
                events.safeOn(EVENT_TYPES.PAYMENT.ROLLBACK, this.handleRollback.bind(this));
            }

            this.logger.info('Payment processor initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('Payment processor initialization failed:', error);
            if (process.env.NODE_ENV === 'production') {
                throw error;
            }
            return false;
        }
    }

    async verifyStripeConnection() {
        try {
            // Verify API key is valid
            await stripe.paymentIntents.list({ limit: 1 });
            this.stripeConnected = true;
            this.logger.info('Stripe connection verified');
        } catch (error) {
            this.logger.error('Stripe connection failed:', error);
            this.stripeConnected = false;
            if (process.env.NODE_ENV === 'production') {
                throw error;
            }
        }
    }

    async initializeFeatures() {
        // Initialize feature flags
        this.features.set('retryEnabled', true);
        this.features.set('webhooksEnabled', true);
        this.features.set('refundsEnabled', process.env.NODE_ENV === 'production');
        this.features.set('disputesEnabled', process.env.NODE_ENV === 'production');
        this.features.set('subscriptionsEnabled', false);

        this.logger.info('Payment features initialized', {
            features: Object.fromEntries(this.features)
        });
    }

    async processPayment(data) {
        if (!this.stripeConnected) {
            throw createError.service(
                ERROR_CODES.SERVICE_NOT_READY,
                'Payment service not ready'
            );
        }

        const transactionManager = this.getDependency('transaction-manager');
        const txId = await transactionManager.beginTransaction({
            type: 'payment',
            metadata: data.metadata
        });

        try {
            const { amount, currency = 'cad', metadata = {} } = data;

            // Create payment intent with confirmation required
            const paymentIntent = await stripe.paymentIntents.create({
                amount,
                currency,
                metadata: {
                    ...metadata,
                    environment: process.env.NODE_ENV,
                    transactionId: txId
                },
                confirmation_method: 'manual',
                capture_method: 'manual'
            });

            // Record the payment intent in transaction
            await transactionManager.addOperation(txId, {
                type: 'payment_intent',
                data: paymentIntent,
                rollback: async () => {
                    if (paymentIntent.status !== 'canceled') {
                        await stripe.paymentIntents.cancel(paymentIntent.id);
                    }
                }
            });

            this.logger.info('Payment intent created', {
                amount,
                currency,
                paymentIntentId: paymentIntent.id,
                transactionId: txId
            });

            // Update metrics
            this.metrics.attempts++;
            this.metrics.success++;
            this.metrics.latencies.push(Date.now() - data.startTime);
            if (this.metrics.latencies.length > 100) {
                this.metrics.latencies.shift();
            }

            return {
                paymentIntent,
                transactionId: txId
            };
        } catch (error) {
            // Update metrics
            this.metrics.failed++;

            await transactionManager.rollbackTransaction(txId);
            this.logger.error('Payment processing failed:', {
                error: error.message,
                transactionId: txId
            });
            throw createError.payment(
                ERROR_CODES.PAYMENT_PROCESSING_ERROR,
                'Failed to process payment'
            );
        }
    }

    async handleRollback(data) {
        try {
            const { paymentIntentId, reason } = data;
            await stripe.paymentIntents.cancel(paymentIntentId);
            this.logger.info('Payment rolled back successfully', {
                paymentIntentId,
                reason
            });
        } catch (error) {
            this.logger.error('Payment rollback failed:', error);
        }
    }

    async _cleanup() {
        this.stripeConnected = false;
        this.features.clear();
        this.metrics = {
            attempts: 0,
            success: 0,
            failed: 0,
            latencies: []
        };
        this.logger.info('Payment processor cleaned up');
    }

    getHealth() {
        const avgLatency = this.metrics.latencies.length > 0
            ? this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length
            : 0;

        return {
            status: this.stripeConnected ? 'healthy' : 'unhealthy',
            stripeConnected: this.stripeConnected,
            features: Object.fromEntries(this.features),
            metrics: {
                attempts: this.metrics.attempts,
                success: this.metrics.success,
                failed: this.metrics.failed,
                successRate: this.metrics.attempts > 0
                    ? (this.metrics.success / this.metrics.attempts) * 100
                    : 100,
                avgLatency
            }
        };
    }
}

module.exports = new PaymentProcessor(); 