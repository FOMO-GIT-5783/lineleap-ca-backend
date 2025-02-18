const express = require('express');
const router = express.Router();
const PassService = require('../services/passService.cjs');
const { requireCustomer, requireBartender } = require('../middleware/authMiddleware.cjs');
const OrderMetricsService = require('../services/orderMetricsService.cjs');
const { requireAuth } = require('../middleware/authMiddleware.cjs');
const Pass = require('../models/Pass.cjs');
const User = require('../models/User.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');

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
router.post('/purchase', requireCustomer(), async (req, res) => {
    try {
        const pass = await PassService.purchasePass({
            ...req.body,
            userId: req.user.id
        });
        await OrderMetricsService.trackPassPurchase(pass);
        res.json({ 
            status: 'success', 
            data: { 
                pass,
                verificationCode: pass.verificationCode 
            }
        });
    } catch (error) {
        console.error('Error purchasing pass:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

router.get('/:passId', requireAuth(), async (req, res, next) => {
    try {
        const pass = await Pass.findById(req.params.passId)
            .populate('venue', 'name location')
            .populate('user', 'name email');

        if (!pass) {
            throw createError.notFound(ERROR_CODES.PASS_NOT_FOUND, 'Pass not found');
        }

        // Only allow pass owner or venue staff to view pass
        if (pass.user._id.toString() !== req.user._id.toString() && 
            !req.user.managedVenues.includes(pass.venue._id)) {
            throw createError.unauthorized(ERROR_CODES.UNAUTHORIZED_ACCESS, 'Unauthorized access to pass');
        }

        res.json(pass);
    } catch (error) {
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

router.get('/active', requireBartender, async (req, res) => {
    try {
        const { venueId } = req.query;
        const passes = await PassService.getActivePasses(venueId);
        res.json({ status: 'success', data: passes });
    } catch (error) {
        console.error('Error fetching active passes:', error);
        res.status(400).json({ status: 'error', message: error.message });
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
router.post('/:passId/validate', requireAuth(), async (req, res, next) => {
    try {
        const pass = await Pass.findById(req.params.passId)
            .populate('venue', 'name location managedBy')
            .populate('user', 'name email');

        if (!pass) {
            throw createError.notFound(ERROR_CODES.PASS_NOT_FOUND, 'Pass not found');
        }

        // Only allow venue staff to validate pass
        if (!req.user.managedVenues.includes(pass.venue._id)) {
            throw createError.unauthorized(ERROR_CODES.UNAUTHORIZED_ACCESS, 'Unauthorized to validate pass');
        }

        const now = new Date();
        const isValid = pass.status === 'active' && pass.expiresAt > now;

        if (!isValid) {
            throw createError.business(ERROR_CODES.PASS_EXPIRED, 'Pass is expired or already used');
        }

        // Mark pass as used
        pass.status = 'used';
        pass.usedAt = now;
        await pass.save();

        res.json({
            message: 'Pass validated successfully',
            pass
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router; 