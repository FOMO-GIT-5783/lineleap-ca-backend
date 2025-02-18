const express = require('express');
const router = express.Router();
const PaymentProcessor = require('../services/payment/PaymentProcessor.cjs');
const PaymentSecurity = require('../services/payment/PaymentSecurity.cjs');
const logger = require('../utils/logger.cjs');

// Create specialized logger
const webhookLogger = logger.child({
    context: 'webhook',
    service: 'webhook-handler'
});

// Stripe webhook handler
router.post('/stripe', async (req, res, next) => {
    try {
        // Validate webhook signature
        const event = await PaymentSecurity.validateSignature(
            req.rawBody,
            req.headers['stripe-signature']
        );

        // Process webhook event
        const result = await PaymentProcessor.handleWebhook(event);

        webhookLogger.info('Webhook processed successfully', {
            type: event.type,
            id: event.id
        });

        res.json({ received: true });

    } catch (error) {
        webhookLogger.error('Webhook processing failed:', {
            error: error.message,
            type: error.type,
            code: error.code
        });
        next(error);
    }
});

module.exports = router; 