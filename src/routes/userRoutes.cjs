const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware.cjs');
const User = require('../models/User.cjs');
const logger = require('../utils/logger.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');

// Create specialized logger
const userLogger = logger.child({
    context: 'users',
    service: 'user-routes'
});

// Get current user
router.get('/me', requireAuth(), async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id)
            .select('-password')
            .populate('managedVenues', 'name location');
        
        res.json({ status: 'success', data: user });
    } catch (error) {
        userLogger.error('Failed to fetch user profile:', error);
        next(error);
    }
});

// Update current user
router.patch('/me', requireAuth(), async (req, res, next) => {
    try {
        const allowedUpdates = ['name', 'phone', 'preferences'];
        const updates = Object.keys(req.body)
            .filter(key => allowedUpdates.includes(key))
            .reduce((obj, key) => {
                obj[key] = req.body[key];
                return obj;
            }, {});

        if (Object.keys(updates).length === 0) {
            throw createError.validation(
                ERROR_CODES.INVALID_UPDATE,
                'No valid fields to update'
            );
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('-password');

        userLogger.info('User profile updated', {
            userId: user._id,
            updates: Object.keys(updates)
        });

        res.json({ status: 'success', data: user });
    } catch (error) {
        userLogger.error('Failed to update user profile:', error);
        next(error);
    }
});

// Admin routes
router.get('/', requireAdmin(), async (req, res, next) => {
    try {
        const users = await User.find()
            .select('-password')
            .sort('-createdAt');
        
        res.json({ status: 'success', data: users });
    } catch (error) {
        userLogger.error('Failed to fetch users:', error);
        next(error);
    }
});

router.get('/:userId', requireAdmin(), async (req, res, next) => {
    try {
        const user = await User.findById(req.params.userId)
            .select('-password')
            .populate('managedVenues', 'name location');

        if (!user) {
            throw createError.notFound(ERROR_CODES.USER_NOT_FOUND);
        }

        res.json({ status: 'success', data: user });
    } catch (error) {
        userLogger.error('Failed to fetch user:', error);
        next(error);
    }
});

router.patch('/:userId', requireAdmin(), async (req, res, next) => {
    try {
        const allowedUpdates = ['name', 'email', 'roles', 'status'];
        const updates = Object.keys(req.body)
            .filter(key => allowedUpdates.includes(key))
            .reduce((obj, key) => {
                obj[key] = req.body[key];
                return obj;
            }, {});

        if (Object.keys(updates).length === 0) {
            throw createError.validation(
                ERROR_CODES.INVALID_UPDATE,
                'No valid fields to update'
            );
        }

        const user = await User.findByIdAndUpdate(
            req.params.userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('-password');

        if (!user) {
            throw createError.notFound(ERROR_CODES.USER_NOT_FOUND);
        }

        userLogger.info('User updated by admin', {
            adminId: req.user._id,
            userId: user._id,
            updates: Object.keys(updates)
        });

        res.json({ status: 'success', data: user });
    } catch (error) {
        userLogger.error('Failed to update user:', error);
        next(error);
    }
});

module.exports = router; 