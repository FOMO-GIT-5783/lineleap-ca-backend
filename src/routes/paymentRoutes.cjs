const express = require('express');
const router = express.Router();
const { requireCustomer } = require('../middleware/authMiddleware.cjs');
const { validatePayment } = require('../middleware/validationMiddleware.cjs');
const { verifyPaymentIntent } = require('../middleware/paymentVerification.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const PaymentProcessor = require('../services/payment/PaymentProcessor.cjs');
const PaymentSecurity = require('../services/payment/PaymentSecurity.cjs');
const FeatureManager = require('../services/payment/FeatureManager.cjs');
const logger = require('../utils/logger.cjs');

// Health check endpoint
router.get('/health', async (req, res) => {
    try {
        const health = await PaymentProcessor.healthCheck();
        res.json(health);
    } catch (error) {
        logger.error('Payment health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Generic payment intent creation endpoint
router.post('/create-intent',
    requireCustomer(),
    validatePayment,
    async (req, res, next) => {
    try {
        const { venueId, type, items, passType } = req.body;

        // Common payment data
        const paymentData = {
            venueId,
            userId: req.user._id,
            type,
            metadata: {
                userId: req.user._id.toString()
            }
        };

        // Handle different payment types
        if (type === 'pass_purchase') {
            const total = await PaymentProcessor.calculatePassTotal(venueId, passType);
            paymentData.amount = Math.round(total.final * 100);
            paymentData.metadata.passType = passType;
            paymentData.metadata.serviceFee = total.serviceFee.toString();
            paymentData.metadata.calculatedTotal = total.final.toString();
        } else if (type === 'drink_order') {
            const total = await PaymentProcessor.calculateOrderTotal(venueId, items);
            paymentData.amount = Math.round(total.final * 100);
            paymentData.metadata.items = JSON.stringify(items);
            paymentData.metadata.calculatedTotal = total.final.toString();
        } else {
            throw createError.validation(
                ERROR_CODES.INVALID_PAYMENT_TYPE,
                'Invalid payment type'
            );
        }

        // Validate payment data
        await PaymentSecurity.validateAmount(paymentData.amount, {
            venueId,
            type,
            items
        });
        await PaymentSecurity.validateMetadata(paymentData.metadata);

        // Process payment with new flow
        const { paymentIntent, transactionId } = await PaymentProcessor.processPayment(paymentData);

        res.json({
            status: 'success',
            data: {
                clientSecret: paymentIntent.client_secret,
                transactionId,
                breakdown: {
                    subtotal: paymentData.amount / 100,
                    serviceFee: parseFloat(paymentData.metadata.serviceFee || 0),
                    total: parseFloat(paymentData.metadata.calculatedTotal)
                }
            }
        });
    } catch (error) {
        logger.error('Payment intent creation failed:', {
            error,
            userId: req.user._id
        });
        next(error);
    }
});

// Enhanced payment confirmation endpoint
router.post('/confirm-payment',
    requireCustomer(),
    verifyPaymentIntent,
    async (req, res, next) => {
    try {
        const { paymentIntentId, transactionId } = req.body;

        // Payment intent already verified by middleware
        const confirmedPayment = await PaymentProcessor.confirmPayment(
            paymentIntentId,
            transactionId
        );

        res.json({
            status: 'success',
            data: {
                paymentId: confirmedPayment.id,
                status: confirmedPayment.status,
                amount: confirmedPayment.amount
            }
        });
    } catch (error) {
        logger.error('Payment confirmation failed:', {
            error,
            userId: req.user._id,
            paymentIntent: req.paymentIntent?.id
        });
        next(error);
    }
});

// Unified webhook handler
router.post('/webhook', async (req, res, next) => {
    try {
        // Validate webhook signature
        const event = await PaymentSecurity.validateSignature(
            req.rawBody,
            req.headers['stripe-signature']
        );

        // Process webhook
        const result = await PaymentProcessor.handleWebhook(event);
        res.json({ received: true });
    } catch (error) {
        logger.error('Webhook handling failed:', error);
        next(error);
    }
});

// Feature management endpoints (admin only)
router.post('/features/:feature',
    requireCustomer({ role: 'admin' }),
    async (req, res, next) => {
    try {
        const { feature } = req.params;
        const { enabled, context } = req.body;

        await FeatureManager.setFeatureState(feature, enabled, context);

        res.json({
            status: 'success',
            data: await FeatureManager.getFeatureStates()
        });
    } catch (error) {
        logger.error('Feature management failed:', error);
        next(error);
    }
});

module.exports = router; 