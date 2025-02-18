const express = require('express');
const router = express.Router();
const PassService = require('../services/passService.cjs');
const { requireCustomer, requireBartender } = require('../middleware/authMiddleware.cjs');
const OrderMetricsService = require('../services/orderMetricsService.cjs');
const { requireAuth } = require('../middleware/authMiddleware.cjs');
const Pass = require('../models/Pass.cjs');
const User = require('../models/User.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const PaymentProcessor = require('../services/payment/PaymentProcessor.cjs');
const logger = require('../utils/logger.cjs');

// Create specialized logger
const passLogger = logger.child({
    context: 'passes',
    service: 'pass-routes'
});

// Customer Pass Routes
// ==================

// Pass Purchase & History
router.get('/venue/:venueId/available', requireCustomer(), async (req, res) => {
    try {
        const { venueId } = req.params;
        const passes = await PassService.getAvailablePasses(venueId);
        res.json({ status: 'success', data: passes });
    } catch (error) {
        console.error('Error fetching available passes:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

router.get('/history', requireCustomer(), async (req, res) => {
    try {
        const passes = await PassService.getPassesByUser(req.user.id);
        res.json({ status: 'success', data: passes });
    } catch (error) {
        console.error('Error fetching pass history:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// Pass Purchase & Redemption
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
        const pass = await Pass.create({
            venueId,
            userId: req.user._id,
            type,
            paymentIntentId,
            idempotencyKey,
            purchaseAmount: payment.amount,
            purchaseDate: new Date(),
            status: 'active'
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

router.get('/:passId', requireAuth(), async (req, res, next) => {
    try {
        const { passId } = req.params;
        const pass = await PassService.getPassById(passId);
        
        if (!pass) {
            throw createError.notFound(ERROR_CODES.PASS_NOT_FOUND);
        }

        // Verify ownership or staff access
        if (!pass.userId.equals(req.user._id) && !req.user.hasRole(['admin', 'bartender'])) {
            throw createError.authorization(ERROR_CODES.UNAUTHORIZED);
        }

        res.json({ status: 'success', data: pass });
    } catch (error) {
        passLogger.error('Failed to fetch pass:', error);
        next(error);
    }
});

router.post('/:passId/redeem', requireCustomer(), async (req, res) => {
    try {
        const { passId } = req.params;
        const { verificationCode } = req.body;
        const pass = await PassService.redeemPass(passId, verificationCode);
        await OrderMetricsService.trackPassRedemption(pass, true);
        res.json({ status: 'success', data: pass });
    } catch (error) {
        console.error('Error redeeming pass:', error);
        const { passId } = req.params;
        await OrderMetricsService.trackPassRedemption({ _id: passId }, false);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// Bartender Pass Routes
// ===================

router.get('/venue/:venueId/active', requireBartender(), async (req, res, next) => {
    try {
        const { venueId } = req.params;
        const passes = await PassService.getActivePasses(venueId);
        res.json({ status: 'success', data: passes });
    } catch (error) {
        passLogger.error('Failed to fetch active passes:', error);
        next(error);
    }
});

router.patch('/:passId/status', requireBartender, async (req, res) => {
    try {
        const { passId } = req.params;
        const { status } = req.body;
        const pass = await PassService.updatePassStatus(passId, status);
        await OrderMetricsService.trackPassStatusChange(pass);
        res.json({ status: 'success', data: pass });
    } catch (error) {
        console.error('Error updating pass status:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

router.post('/:passId/verify', requireBartender, async (req, res) => {
    try {
        const { passId } = req.params;
        const { verificationCode } = req.body;
        const pass = await PassService.verifyPassByBartender(passId, verificationCode);
        await OrderMetricsService.trackPassVerification(pass, true);
        res.json({ status: 'success', data: pass });
    } catch (error) {
        console.error('Error verifying pass:', error);
        const { passId } = req.params;
        await OrderMetricsService.trackPassVerification({ _id: passId }, false);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// Get user's passes
router.get('/mine', requireCustomer(), async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id)
            .populate('passes.venue', 'name location');

        const now = new Date();
        const passes = {
            active: user.passes.filter(p => p.status === 'active' && p.expiresAt > now),
            expired: user.passes.filter(p => p.status === 'used' || p.expiresAt <= now)
        };

        res.json(passes);
    } catch (error) {
        next(error);
    }
});

// Validate pass
router.post('/:passId/validate', requireBartender(), async (req, res, next) => {
    try {
        const { passId } = req.params;
        const isValid = await PassService.validatePass(passId);
        
        res.json({ 
            status: 'success', 
            data: { 
                valid: isValid,
                passId
            } 
        });
    } catch (error) {
        passLogger.error('Failed to validate pass:', error);
        next(error);
    }
});

// Get all passes for a venue
router.get('/venue/:venueId', requireAuth(), async (req, res, next) => {
    try {
        const { venueId } = req.params;
        const passes = await Pass.find({ venueId }).sort('-purchaseDate');
        res.json({ status: 'success', data: passes });
    } catch (error) {
        passLogger.error('Failed to fetch venue passes:', error);
        next(error);
    }
});

// Get user's passes
router.get('/my-passes', requireCustomer(), async (req, res, next) => {
    try {
        const passes = await PassService.getPassesByUser(req.user._id);
        res.json({ status: 'success', data: passes });
    } catch (error) {
        passLogger.error('Failed to fetch user passes:', error);
        next(error);
    }
});

// Cancel a pass
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

        pass.status = 'cancelled';
        pass.statusHistory.push({
            status: 'cancelled',
            timestamp: new Date(),
            updatedBy: req.user._id
        });
        await pass.save();

        // Initiate refund if eligible
        if (pass.isEligibleForRefund()) {
            await PaymentProcessor.refundPass(pass);
        }

        passLogger.info('Pass cancelled successfully', {
            passId: pass._id,
            userId: req.user._id
        });

        res.json({ status: 'success', data: pass });
    } catch (error) {
        passLogger.error('Failed to cancel pass:', error);
        next(error);
    }
});

module.exports = router; 