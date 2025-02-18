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
        if (instance) return instance;
        super('payment-processor');
        this.startTime = Date.now();
        this.stripeConnected = false;
        this.logger = logger.child({
            context: 'payment',
            service: 'payment-processor'
        });
        instance = this;
    }

    static getInstance() {
        if (!instance) {
            instance = new PaymentProcessor();
        }
        return instance;
    }

    async _init() {
        try {
            if (!process.env.STRIPE_SECRET_KEY) {
                throw new Error('Stripe secret key not configured');
            }

            // Verify Stripe connection
            await stripe.paymentMethods.list({ limit: 1 });
            this.stripeConnected = true;
            
            this.logger.info('Payment processor initialized', {
                stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? 'test' : 'live',
                status: 'connected'
            });

            return true;
        } catch (error) {
            this.logger.error('Failed to initialize payment processor:', {
                error: error.message,
                code: error.code
            });
            
            this.stripeConnected = false;

            // Don't throw in development
            if (process.env.NODE_ENV === 'production') {
                throw error;
            }
            
            return false;
        }
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

            return {
                paymentIntent,
                transactionId: txId
            };
        } catch (error) {
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

    async confirmPayment(paymentIntentId, transactionId) {
        if (!this.stripeConnected) {
            throw createError.service(
                ERROR_CODES.SERVICE_NOT_READY,
                'Payment service not ready'
            );
        }

        const transactionManager = this.getDependency('transaction-manager');
        const transaction = transactionManager.getTransactionState(transactionId);

        if (!transaction) {
            throw createError.notFound(
                ERROR_CODES.TRANSACTION_NOT_FOUND,
                'Transaction not found'
            );
        }

        try {
            // Confirm the payment intent
            const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId);

            // Verify payment success
            if (paymentIntent.status !== 'requires_capture') {
                throw createError.payment(
                    ERROR_CODES.PAYMENT_CONFIRMATION_FAILED,
                    'Payment confirmation failed'
                );
            }

            // Capture the payment
            const capturedIntent = await stripe.paymentIntents.capture(paymentIntentId);

            // Commit transaction if payment successful
            if (capturedIntent.status === 'succeeded') {
                await transactionManager.commitTransaction(transactionId);
                
                this.logger.info('Payment confirmed and captured', {
                    paymentIntentId,
                    transactionId,
                    amount: capturedIntent.amount
                });

                return capturedIntent;
            }

            throw createError.payment(
                ERROR_CODES.PAYMENT_CAPTURE_FAILED,
                'Payment capture failed'
            );
        } catch (error) {
            await transactionManager.rollbackTransaction(transactionId);
            this.logger.error('Payment confirmation failed:', {
                error: error.message,
                paymentIntentId,
                transactionId
            });
            throw error;
        }
    }

    async validatePayment(paymentIntent) {
        if (!this.stripeConnected) {
            throw createError.service(
                ERROR_CODES.SERVICE_NOT_READY,
                'Payment service not ready'
            );
        }

        try {
            // Retrieve and validate payment intent
            const intent = await stripe.paymentIntents.retrieve(paymentIntent.id);

            if (intent.status !== 'succeeded') {
                throw createError.payment(
                    ERROR_CODES.PAYMENT_VALIDATION_FAILED,
                    'Payment validation failed'
                );
            }

            this.logger.info('Payment validated', {
                paymentIntentId: intent.id,
                amount: intent.amount,
                status: intent.status
            });

            return true;
        } catch (error) {
            this.logger.error('Payment validation failed:', error);
            throw error;
        }
    }

    async handleWebhook(rawBody, signature) {
        if (!this.stripeConnected) {
            throw createError.service(
                ERROR_CODES.SERVICE_NOT_READY,
                'Payment service not ready'
            );
        }

        try {
            // Verify webhook signature
            const event = stripe.webhooks.constructEvent(
                rawBody,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );

            this.logger.info('Webhook received', {
                type: event.type,
                id: event.id
            });

            // Process different event types
            switch (event.type) {
                case 'payment_intent.succeeded':
                    await this.handlePaymentSuccess(event.data.object);
                    break;
                case 'payment_intent.payment_failed':
                    await this.handlePaymentFailure(event.data.object);
                    break;
                default:
                    this.logger.info('Unhandled webhook event', { type: event.type });
            }

            return {
                received: true,
                type: event.type
            };
        } catch (error) {
            this.logger.error('Webhook handling failed:', error);
            throw error;
        }
    }

    async handlePaymentSuccess(paymentIntent) {
        this.logger.info('Payment succeeded', {
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount
        });
    }

    async handlePaymentFailure(paymentIntent) {
        this.logger.error('Payment failed', {
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount,
            error: paymentIntent.last_payment_error
        });
    }

    async healthCheck() {
        try {
            if (!this.stripeConnected) {
                // Try to reconnect
                await stripe.paymentMethods.list({ limit: 1 });
                this.stripeConnected = true;
            }
            
            return {
                status: 'healthy',
                service: 'payment-processor',
                uptime: (Date.now() - this.startTime) / 1000,
                stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? 'test' : 'live',
                stripeConnected: this.stripeConnected
            };
        } catch (error) {
            this.logger.error('Health check failed:', error);
            return {
                status: 'unhealthy',
                service: 'payment-processor',
                error: error.message,
                uptime: (Date.now() - this.startTime) / 1000,
                stripeConnected: this.stripeConnected
            };
        }
    }

    async _cleanup() {
        this.stripeConnected = false;
        this.logger.info('Payment processor cleaned up');
    }
}

module.exports = PaymentProcessor.getInstance(); 