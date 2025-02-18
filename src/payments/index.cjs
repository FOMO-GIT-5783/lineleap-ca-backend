// Update payments/index.js
const express = require('express');
const router = express.Router();
const stripe = require('../config/stripeConfig.cjs');
const logger = require('../utils/logger.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const passPayments = require('./passPayments.cjs');
const drinkPayments = require('./drinkPayments.cjs');
const { handleWithRetry } = require('../utils/orderUtils.cjs');
const { withTransaction } = require('../utils/transaction.cjs');
const cacheService = require('../services/cacheService.cjs');

// Get cache instances for webhook event tracking
const processedEvents = cacheService.getCache('GENERAL');
const failedEvents = cacheService.getCache('RATE_LIMIT');

const MAX_WEBHOOK_RETRIES = 3;

// Enhanced webhook error handler with monitoring
const handleWebhookError = (err, eventId) => {
    // Track failed event
    const failureCount = (failedEvents.get(eventId) || 0) + 1;
    failedEvents.set(eventId, failureCount);

    // Log failure with context
    logger.error('Webhook error:', {
        eventId,
        failureCount,
        error: err.message,
        type: err.type,
        code: err.code
    });

    if (err.type === 'StripeSignatureVerificationError') {
        throw createError.validation(
            ERROR_CODES.INVALID_SIGNATURE,
            'Invalid webhook signature'
        );
    }
    
    if (err.type === 'StripeInvalidRequestError') {
        throw createError.validation(
            ERROR_CODES.INVALID_REQUEST,
            err.message
        );
    }
    
    throw createError.service(
        ERROR_CODES.PAYMENT_SERVICE_ERROR,
        'Payment service error',
        { originalError: err.message }
    );
};

// Enhanced webhook handler with replay protection and monitoring
router.post('/webhook', async (req, res, next) => {
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.rawBody,
            req.headers['stripe-signature'],
            process.env.STRIPE_WEBHOOK_SECRET
        );

        // Check for replay
        if (processedEvents.has(event.id)) {
            logger.warn('Webhook replay detected', { 
                eventId: event.id,
                type: event.type,
                timestamp: new Date().toISOString()
            });
            return res.status(200).json({ received: true }); // Return 200 to stop retries
        }

        // Check retry limits
        const failureCount = failedEvents.get(event.id) || 0;
        if (failureCount >= MAX_WEBHOOK_RETRIES) {
            logger.error('Max retries exceeded for webhook', { 
                eventId: event.id,
                failureCount,
                type: event.type
            });
            return res.status(200).json({ received: true }); // Acknowledge to stop retries
        }

        // Process webhook with transaction
        await withTransaction(async (session) => {
            switch (event.type) {
                case 'payment_intent.succeeded':
                    if (event.data.object.metadata.type === 'pass_purchase') {
                        await passPayments.handlePassWebhook(req.rawBody, req.headers['stripe-signature'], session);
                    } else {
                        await drinkPayments.handleDrinkWebhook(req.rawBody, req.headers['stripe-signature'], session);
                    }
                    break;
                case 'payment_intent.payment_failed':
                    if (event.data.object.metadata.type === 'pass_purchase') {
                        await passPayments.handlePassWebhook(req.rawBody, req.headers['stripe-signature'], session);
                    } else {
                        await drinkPayments.handleDrinkWebhook(req.rawBody, req.headers['stripe-signature'], session);
                    }
                    break;
                default:
                    logger.info('Ignoring non-payment webhook event', { type: event.type });
                    break;
            }
        });

        // Mark event as processed
        processedEvents.set(event.id, true);

        // Clear failure count on success
        failedEvents.delete(event.id);

        res.json({ received: true });
    } catch (err) {
        next(handleWebhookError(err, event?.id));
    }
});

module.exports = router;
