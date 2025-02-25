const Order = require('../models/Order.cjs');
const Venue = require('../models/Venue.cjs');
const MenuItem = require('../models/MenuItem.cjs');
const { ORDER_EVENTS } = require('../utils/constants.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const logger = require('../utils/logger.cjs');
const { emitVenueUpdate } = require('../websocket/socketManager.cjs');
const { HalifaxMetricRecorder, FOMO_METRIC_TYPES, CORE_METRIC_TYPES } = require('./MetricService.cjs');
const LockManager = require('../utils/lockManager.cjs');
const PassService = require('../services/passService.cjs');

class OrderService {
    static async getVenueMenu(venueId, userId) {
        try {
            const menu = await MenuItem.aggregate([
                { $match: { venueId, available: true } },
                { $sort: { categoryOrder: 1, itemOrder: 1 } },
                {
                    $group: {
                        _id: '$category',
                        items: { $push: '$$ROOT' }
                    }
                }
            ]).exec();

            return {
                categories: menu || []
            };
        } catch (error) {
            logger.error('Failed to fetch venue menu:', error);
            throw createError.internal('Failed to fetch menu');
        }
    }

    static async getOrdersByUser(userId) {
        try {
            const orders = await Order.find({ userId })
                .sort({ createdAt: -1 })
                .populate('items.menuItem')
                .lean()
                .exec();

            return orders || [];
        } catch (error) {
            logger.error('Failed to fetch user orders:', error);
            throw createError.internal('Failed to fetch orders');
        }
    }

    static async getOrderById(orderId) {
        try {
            const order = await Order.findById(orderId)
                .populate('items.menuItem')
                .populate('userId', 'name email')
                .lean()
                .exec();

            if (!order) {
                throw createError.notFound(ERROR_CODES.ORDER_NOT_FOUND);
            }

            return order;
        } catch (error) {
            if (error.code === ERROR_CODES.ORDER_NOT_FOUND) throw error;
            logger.error('Failed to fetch order:', error);
            throw createError.internal('Failed to fetch order');
        }
    }

    static async createOrder(orderData) {
        const lockId = await LockManager.acquireLock('order', orderData.userId);

        try {
            // Create pass first
            const pass = await PassService.createEventPass(orderData);

            // Create order with pass reference
            const order = await Order.create({
                userId: orderData.userId,
                venueId: orderData.venueId,
                items: orderData.items,
                status: ORDER_EVENTS.CREATED,
                pass: pass._id,
                subtotal: orderData.subtotal,
                total: orderData.total,
                createdAt: new Date()
            });

            return order;
        } catch (error) {
            logger.error('Failed to create order:', error);
            throw createError.internal('Failed to create order');
        } finally {
            await LockManager.releaseLock(lockId);
        }
    }

    static async updateOrderStatus(orderId, newStatus) {
        const order = await Order.findById(orderId);
        
        if (!order) {
            throw createError.notFound(ERROR_CODES.ORDER_NOT_FOUND);
        }

        order.addStatusHistory(newStatus);
        await order.save();

        // Emit update
        emitVenueUpdate(order.venueId, newStatus, { 
            orderId: order._id, 
            status: newStatus 
        });

        return order;
    }

    static async cancelOrder(orderId) {
        const order = await Order.findById(orderId);
        
        if (!order) {
            throw createError.notFound(ERROR_CODES.ORDER_NOT_FOUND);
        }

        if (!['created', 'accepted'].includes(order.status)) {
            throw createError.badRequest(ERROR_CODES.ORDER_CANNOT_BE_CANCELLED);
        }

        order.addStatusHistory(ORDER_EVENTS.CANCELLED);
        await order.save();

        // Emit update
        emitVenueUpdate(order.venueId, ORDER_EVENTS.CANCELLED, { 
            orderId: order._id, 
            status: ORDER_EVENTS.CANCELLED 
        });

        return order;
    }

    static async addOrderNote(orderId, note) {
        const order = await Order.findById(orderId);
        
        if (!order) {
            throw createError.notFound(ERROR_CODES.ORDER_NOT_FOUND);
        }

        order.notes.push(note);
        await order.save();

        return order;
    }

    static async updateOrderInstructions(orderId, instructions) {
        const order = await Order.findById(orderId);
        
        if (!order) {
            throw createError.notFound(ERROR_CODES.ORDER_NOT_FOUND);
        }

        if (order.status !== ORDER_EVENTS.CREATED) {
            throw createError.badRequest(ERROR_CODES.ORDER_CANNOT_BE_MODIFIED);
        }

        order.specialInstructions = instructions;
        await order.save();

        return order;
    }

    static async completeOrder(orderId) {
        const order = await Order.findById(orderId);
        if (!order) {
            throw new Error('Order not found');
        }

        const metricService = new HalifaxMetricRecorder();

        // Core completion logic
        order.status = 'completed';
        order.completedAt = new Date();
        await order.save();

        // Track manual verification ("I Am The Bartender" click)
        await metricService.record(FOMO_METRIC_TYPES.DRINK.FULFILLMENT, {
            venueId: order.venueId,
            itemCount: order.items.length
        });

        // Track manual verification by staff
        await metricService.record(CORE_METRIC_TYPES.PASS.STAFF_VERIFICATION, {
            orderId: order._id,
            success: true,
            staffId: order.staffVerification?.staffId
        });

        return order;
    }
}

module.exports = OrderService; 