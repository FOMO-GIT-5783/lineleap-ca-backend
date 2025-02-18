const express = require('express');
const router = express.Router();
const monitoringDashboard = require('../utils/monitoringDashboard.cjs');
const logger = require('../utils/logger.cjs');
const PaymentMetrics = require('../services/payment/PaymentMetrics.cjs');
const FeatureManager = require('../services/payment/FeatureManager.cjs');
const wsMonitor = require('../utils/websocketMonitor.cjs');
const cacheService = require('../services/cacheService.cjs');

const monitorLogger = logger.child({
    context: 'monitoring',
    service: 'system-monitor'
});

// Internal auth middleware
const internalAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const internalKey = process.env.INTERNAL_API_KEY;

    if (!apiKey || apiKey !== internalKey) {
        // Still allow localhost in development
        if (process.env.NODE_ENV === 'development' && 
            (req.ip === '::1' || req.ip === '127.0.0.1')) {
            return next();
        }
        return res.status(401).json({
            status: 'error',
            message: 'Unauthorized'
        });
    }
    next();
};

// Get all metrics
router.get('/', internalAuth, async (req, res) => {
    try {
        const metrics = monitoringDashboard.getMetrics();
        res.json({
            status: 'success',
            data: metrics
        });
    } catch (error) {
        logger.error('Error fetching metrics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch metrics'
        });
    }
});

// Get venue-specific metrics
router.get('/venue/:venueId', internalAuth, async (req, res) => {
    try {
        const { venueId } = req.params;
        const metrics = monitoringDashboard.getMetrics();
        
        res.json({
            status: 'success',
            data: {
                venue: metrics.venues[venueId] || {},
                optimization: metrics.optimizations[venueId] || {},
                connections: metrics.connections[venueId] || {},
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        logger.error('Error fetching venue metrics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch venue metrics'
        });
    }
});

// Get WebSocket metrics only
router.get('/websocket', internalAuth, async (req, res) => {
    try {
        const metrics = monitoringDashboard.getMetrics();
        res.json({
            status: 'success',
            data: {
                ...metrics.websocket,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        logger.error('Error fetching WebSocket metrics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch WebSocket metrics'
        });
    }
});

// Get system metrics
router.get('/metrics', internalAuth, async (req, res) => {
    try {
        const metrics = {
            timestamp: new Date().toISOString(),
            websocket: wsMonitor.getMetrics(),
            cache: cacheService.getMetrics(),
            payment: await PaymentMetrics.getMetrics(),
            features: await FeatureManager.getFeatureStates(),
            system: {
                memory: process.memoryUsage(),
                cpu: process.cpuUsage(),
                uptime: process.uptime(),
                nodeVersion: process.version
            }
        };

        monitorLogger.info('System metrics collected', { metrics });
        res.json({
            status: 'success',
            data: metrics
        });
    } catch (error) {
        monitorLogger.error('Metrics collection failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to collect metrics',
            error: error.message
        });
    }
});

// Get websocket status
router.get('/websocket', internalAuth, async (req, res) => {
    try {
        const metrics = wsMonitor.getMetrics();
        const health = wsMonitor.getHealth();
        
        const status = {
            timestamp: new Date().toISOString(),
            status: health.status,
            connections: {
                current: metrics.connections,
                peak: metrics.peakConnections || 0,
                rate: metrics.connectionRate || 0
            },
            messages: {
                total: metrics.messageCount || 0,
                rate: metrics.messageRate || 0,
                errors: metrics.errors || 0
            },
            performance: {
                uptime: metrics.uptime,
                latency: metrics.avgLatency || 0,
                memory: metrics.memoryUsage || 0
            },
            lastError: metrics.lastError
        };

        monitorLogger.info('WebSocket status checked', { status });
        res.json({
            status: 'success',
            data: status
        });
    } catch (error) {
        monitorLogger.error('WebSocket status check failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to check WebSocket status',
            error: error.message
        });
    }
});

// Get payment metrics
router.get('/payments', internalAuth, async (req, res) => {
    try {
        const { venueId } = req.query;
        const metrics = await PaymentMetrics.getMetrics(venueId);
        
        res.json({
            status: 'success',
            data: metrics
        });
    } catch (error) {
        monitorLogger.error('Failed to fetch payment metrics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch payment metrics',
            error: error.message
        });
    }
});

// Get feature flag status
router.get('/features', internalAuth, async (req, res) => {
    try {
        const features = await FeatureManager.getFeatureStates();
        
        res.json({
            status: 'success',
            data: features
        });
    } catch (error) {
        monitorLogger.error('Failed to fetch feature states:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch feature states',
            error: error.message
        });
    }
});

// Update feature flag status
router.post('/features/:feature', internalAuth, async (req, res) => {
    try {
        const { feature } = req.params;
        const { enabled, config } = req.body;

        await FeatureManager.setFeatureState(feature, { enabled, ...config });
        
        res.json({
            status: 'success',
            data: await FeatureManager.getFeatureState(feature)
        });
    } catch (error) {
        monitorLogger.error('Failed to update feature state:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update feature state',
            error: error.message
        });
    }
});

// Update rollout stage
router.post('/rollout/:stage', internalAuth, async (req, res) => {
    try {
        const { stage } = req.params;
        const success = await FeatureManager.updateRolloutStage(stage);
        
        if (!success) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid rollout stage'
            });
        }

        res.json({
            status: 'success',
            data: await FeatureManager.getFeatureState('USE_NEW_PAYMENT_PROCESSOR')
        });
    } catch (error) {
        logger.error('Failed to update rollout stage:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update rollout stage'
        });
    }
});

// Get migration progress
router.get('/migration/progress', internalAuth, async (req, res) => {
    try {
        const metrics = await PaymentMetrics.getMetrics();
        const features = FeatureManager.getAllFeatures();
        
        // Calculate migration progress
        const newProcessorMetrics = metrics.payment.new_processor || {};
        const oldProcessorMetrics = metrics.payment.old_processor || {};
        
        const progress = {
            percentage: features.USE_NEW_PAYMENT_PROCESSOR.rolloutPercentage,
            metrics: {
                success_rate: {
                    old: oldProcessorMetrics.success_rate || 100,
                    new: newProcessorMetrics.success_rate || 100,
                    diff: (newProcessorMetrics.success_rate || 100) - (oldProcessorMetrics.success_rate || 100)
                },
                latency: {
                    old: oldProcessorMetrics.latency || 0,
                    new: newProcessorMetrics.latency || 0,
                    diff: (newProcessorMetrics.latency || 0) - (oldProcessorMetrics.latency || 0)
                },
                error_rate: {
                    old: oldProcessorMetrics.error_rate || 0,
                    new: newProcessorMetrics.error_rate || 0,
                    diff: (newProcessorMetrics.error_rate || 0) - (oldProcessorMetrics.error_rate || 0)
                }
            },
            circuit_breaker: metrics.circuit_breaker,
            feature_flags: metrics.feature_flags
        };

        res.json({
            status: 'success',
            data: progress
        });
    } catch (error) {
        logger.error('Failed to fetch migration progress:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch migration progress'
        });
    }
});

module.exports = router; 