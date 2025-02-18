const express = require('express');
const router = express.Router();
const { requireCustomer, requireAuth } = require('../middleware/authMiddleware.cjs');
const OrderService = require('../services/orderService.cjs');
const logger = require('../utils/logger.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const { orderLimiter } = require('../middleware/venueLimiter.cjs');

// Customer Order Routes
// ===================

// Menu & History
router.get('/venue/:venueId/menu', requireCustomer(), async (req, res, next) => {
    try {
        const { venueId } = req.params;
        const { categories, quickAccess } = await OrderService.getVenueMenu(venueId, req.user._id);
        res.json({ status: 'success', data: { categories, quickAccess } });
    } catch (error) {
        logger.error('Failed to fetch menu:', error);
        next(error);
    }
});

router.get('/history', requireAuth(), async (req, res, next) => {
    try {
        if (!req.user?._id) {
            throw createError.authentication(ERROR_CODES.USER_NOT_FOUND, 'User not found');
        }

        const orders = await OrderService.getOrdersByUser(req.user._id);
        res.json({ status: 'success', data: orders });
    } catch (error) {
        logger.error('Failed to fetch order history:', error);
        next(error);
    }
});

// Apply venue-aware rate limiter to order creation
router.post('/', requireCustomer(), orderLimiter, async (req, res, next) => {
    try {
        const order = await OrderService.createOrder({
            userId: req.user._id,
            ...req.body
        });
        res.json({ status: 'success', data: order });
    } catch (error) {
        logger.error('Failed to create order:', error);
        next(error);
    }
});

router.get('/:orderId', requireAuth(), async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const order = await OrderService.getOrderById(orderId);
        
        if (!order) {
            throw createError.notFound(ERROR_CODES.ORDER_NOT_FOUND);
        }
        
        res.json({ status: 'success', data: order });
    } catch (error) {
        logger.error('Failed to fetch order:', error);
        next(error);
    }
});

router.post('/:orderId/notes', requireAuth(), async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const { content } = req.body;
        
        const order = await OrderService.addOrderNote(orderId, {
            content,
            type: 'user'
        });
        
        res.json({ status: 'success', data: order });
    } catch (error) {
        logger.error('Failed to add note:', error);
        next(error);
    }
});

router.patch('/:orderId/instructions', requireCustomer(), async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const { instructions } = req.body;
        
        const order = await OrderService.updateOrderInstructions(orderId, instructions);
        res.json({ status: 'success', data: order });
    } catch (error) {
        logger.error('Failed to update instructions:', error);
        next(error);
    }
});

router.post('/:orderId/cancel', requireCustomer(), async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const order = await OrderService.cancelOrder(orderId);
        res.json({ status: 'success', data: order });
    } catch (error) {
        logger.error('Failed to cancel order:', error);
        next(error);
    }
});

module.exports = router;







