const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/authMiddleware.cjs');
const WebSocketMonitor = require('../utils/websocketMonitor.cjs');
const PaymentMetrics = require('../services/payment/PaymentMetrics.cjs');
const logger = require('../utils/logger.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');

// Create specialized logger
const metricsLogger = logger.child({
    context: 'metrics',
    service: 'metrics-routes'
});

// Get system-wide metrics
router.get('/', requireAdmin(), async (req, res, next) => {
    try {
        const [wsMetrics, paymentMetrics] = await Promise.all([
            WebSocketMonitor.getMetrics(),
            PaymentMetrics.getMetrics()
        ]);

        const metrics = {
            websocket: {
                connections: wsMetrics.connections,
                messageRate: wsMetrics.messageRate,
                activeVenues: wsMetrics.activeVenues,
                optimizedVenues: wsMetrics.optimizedVenues
            },
            payments: {
                success: paymentMetrics.success,
                failed: paymentMetrics.failed,
                total: paymentMetrics.total,
                avgLatency: paymentMetrics.avgLatency
            },
            system: {
                memory: process.memoryUsage(),
                uptime: process.uptime(),
                timestamp: Date.now()
            }
        };

        metricsLogger.info('System metrics retrieved', {
            wsConnections: metrics.websocket.connections,
            paymentSuccess: metrics.payments.success
        });

        res.json({ status: 'success', data: metrics });
    } catch (error) {
        metricsLogger.error('Failed to fetch system metrics:', error);
        next(error);
    }
});

// Get venue-specific metrics
router.get('/venue/:venueId', requireAdmin(), async (req, res, next) => {
    try {
        const { venueId } = req.params;
        const { timeRange } = req.query;

        const wsMetrics = await WebSocketMonitor.getVenueMetrics(venueId);
        const paymentMetrics = await PaymentMetrics.getMetrics(venueId, timeRange);

        const metrics = {
            websocket: {
                connections: wsMetrics.connections,
                messageRate: wsMetrics.messageRate,
                optimizationLevel: wsMetrics.optimizationLevel
            },
            payments: {
                success: paymentMetrics.success,
                failed: paymentMetrics.failed,
                total: paymentMetrics.total,
                avgLatency: paymentMetrics.avgLatency
            },
            timestamp: Date.now()
        };

        metricsLogger.info('Venue metrics retrieved', {
            venueId,
            wsConnections: metrics.websocket.connections,
            paymentSuccess: metrics.payments.success
        });

        res.json({ status: 'success', data: metrics });
    } catch (error) {
        metricsLogger.error('Failed to fetch venue metrics:', error);
        next(error);
    }
});

// Get WebSocket metrics
router.get('/websocket', requireAdmin(), async (req, res, next) => {
    try {
        const metrics = await WebSocketMonitor.getDetailedMetrics();
        
        metricsLogger.info('WebSocket metrics retrieved', {
            totalConnections: metrics.totalConnections,
            activeVenues: metrics.activeVenues.length
        });

        res.json({ status: 'success', data: metrics });
    } catch (error) {
        metricsLogger.error('Failed to fetch WebSocket metrics:', error);
        next(error);
    }
});

// Get payment metrics
router.get('/payments', requireAdmin(), async (req, res, next) => {
    try {
        const { timeRange } = req.query;
        const metrics = await PaymentMetrics.getDetailedMetrics(timeRange);
        
        metricsLogger.info('Payment metrics retrieved', {
            successRate: metrics.successRate,
            totalTransactions: metrics.total
        });

        res.json({ status: 'success', data: metrics });
    } catch (error) {
        metricsLogger.error('Failed to fetch payment metrics:', error);
        next(error);
    }
});

module.exports = router; 