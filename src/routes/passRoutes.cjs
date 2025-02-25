const express = require('express');
const router = express.Router();
const PassService = require('../services/passService.cjs');
const { requireCustomer } = require('../middleware/authMiddleware.cjs');
const OrderMetricsService = require('../services/orderMetricsService.cjs');
const Pass = require('../models/Pass.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const PaymentProcessor = require('../services/payment/PaymentProcessor.cjs');
const logger = require('../utils/logger.cjs');

// Create specialized logger
const passLogger = logger.child({
    context: 'passes',
    service: 'pass-routes'
});

// Pass Purchase & History
router.get('/venue/:venueId/available', requireCustomer(), async (req, res) => {
    try {
        const { venueId } = req.params;
        const passes = await PassService.getAvailablePasses(venueId);
        res.json({ status: 'success', data: passes });
    } catch (error) {
        passLogger.error('Error fetching available passes:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// Purchase pass
router.post('/purchase', requireCustomer(), async (req, res, next) => {
    try {
        const { venueId, type, paymentIntentId, idempotencyKey } = req.body;

        if (!venueId || !type || !paymentIntentId || !idempotencyKey) {
            throw createError.validation(
                ERROR_CODES.MISSING_REQUIRED_FIELD,
                'Missing required fields'
            );
        }

        // Verify payment
        const payment = await PaymentProcessor.verifyPayment(paymentIntentId);
        
        // Create pass
        const pass = await PassService.purchasePass({
            userId: req.user._id,
            venueId,
            passType: type,
            price: payment.amount,
            paymentIntentId,
            idempotencyKey
        });

        passLogger.info('Pass purchased successfully', {
            passId: pass._id,
            userId: req.user._id,
            venueId,
            type
        });

        res.json({ status: 'success', data: pass });
    } catch (error) {
        passLogger.error('Failed to purchase pass:', error);
        next(error);
    }
});

// Get pass details
router.get('/:passId', requireCustomer(), async (req, res, next) => {
    try {
        const { passId } = req.params;
        const pass = await PassService.getPassById(passId);
        
        if (!pass) {
            throw createError.notFound(ERROR_CODES.PASS_NOT_FOUND);
        }

        // Only check if user owns the pass
        if (!pass.userId.equals(req.user._id)) {
            throw createError.authorization(ERROR_CODES.UNAUTHORIZED);
        }

        res.json({ status: 'success', data: pass });
    } catch (error) {
        passLogger.error('Failed to fetch pass:', error);
        next(error);
    }
});

// Use pass (no auth required)
router.post('/:passId/use', async (req, res) => {
    try {
        const { passId } = req.params;
        const { deviceId } = req.body;
        
        const pass = await PassService.usePass(passId, deviceId);
        await OrderMetricsService.trackPassUsage(pass, true);
        
        res.json({ 
            status: 'success', 
            data: {
                pass: {
                    id: pass._id,
                    type: pass.type,
                    status: pass.status,
                    usedAt: pass.usedAt,
                    venue: {
                        id: pass.venueId,
                        name: pass.venueName
                    }
                }
            }
        });
    } catch (error) {
        passLogger.error('Error using pass:', error);
        await OrderMetricsService.trackPassUsage({ _id: req.params.passId }, false);
        res.status(400).json({ 
            status: 'error', 
            message: error.message,
            code: error.code || ERROR_CODES.PASS_USE_ERROR
        });
    }
});

// Get user's passes
router.get('/mine', requireCustomer(), async (req, res, next) => {
    try {
        const passes = await PassService.getUserPasses(req.user._id);
        res.json({ status: 'success', data: passes });
    } catch (error) {
        passLogger.error('Failed to fetch user passes:', error);
        next(error);
    }
});

// Cancel pass
router.post('/:passId/cancel', requireCustomer(), async (req, res, next) => {
    try {
        const pass = await Pass.findById(req.params.passId);
        
        if (!pass) {
            throw createError.notFound(ERROR_CODES.PASS_NOT_FOUND);
        }

        if (pass.userId.toString() !== req.user._id.toString()) {
            throw createError.authorization(
                ERROR_CODES.UNAUTHORIZED,
                'Not authorized to cancel this pass'
            );
        }

        const updatedPass = await PassService.updatePassStatus(pass._id, 'cancelled');

        // Initiate refund if eligible
        if (pass.isEligibleForRefund()) {
            await PaymentProcessor.refundPass(pass);
        }

        passLogger.info('Pass cancelled successfully', {
            passId: pass._id,
            userId: req.user._id
        });

        res.json({ status: 'success', data: updatedPass });
    } catch (error) {
        passLogger.error('Failed to cancel pass:', error);
        next(error);
    }
});

module.exports = router; 