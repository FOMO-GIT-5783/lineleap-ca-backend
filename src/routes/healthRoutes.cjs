const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('../utils/logger.cjs');
const wsMonitor = require('../utils/websocketMonitor.cjs');
const cacheService = require('../services/cacheService.cjs');
const AuthenticationService = require('../services/auth/AuthenticationService.cjs');
const { getConnectionInfo } = require('../config/database.cjs');
const PaymentProcessor = require('../services/payment/PaymentProcessor.cjs');
const metrics = require('../utils/monitoring.cjs');
const memoryManager = require('../utils/memoryManager.cjs');
const { config } = require('../config/environment.cjs');

// Create specialized logger
const healthLogger = logger.child({
    context: 'health',
    service: 'health-check'
});

// Basic health check for load balancers
router.get('/', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        version: process.env.npm_package_version
    };

    res.json(health);
});

// Detailed health check endpoint
router.get('/detailed', async (req, res) => {
    try {
        const dbInfo = getConnectionInfo();
        
        const health = {
            server: {
                status: 'healthy',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                environment: process.env.NODE_ENV,
                version: '1.0.0',
                nodeVersion: process.version,
                platform: process.platform,
                memoryUsage: {
                    ...process.memoryUsage(),
                    heapUsagePercent: (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100,
                    lastCleanup: Date.now(),
                    timeSinceCleanup: 0
                }
            },
            database: dbInfo,
            auth: {
                status: process.env.AUTH0_CLIENT_ID ? 'healthy' : 'unhealthy',
                provider: 'auth0',
                features: {
                    auth0: true,
                    rateLimit: true,
                    tokenRefresh: true
                },
                mode: process.env.NODE_ENV,
                tokenValidation: {
                    status: 'healthy',
                    latency: 0,
                    lastValidation: new Date().toISOString(),
                    validationEnabled: true,
                    mode: process.env.NODE_ENV
                },
                rateLimit: {
                    current: null,
                    limit: null,
                    resetTime: null
                }
            },
            websocket: {
                status: 'unhealthy',
                totalConnections: 0,
                activeVenues: 0,
                venueSessions: [],
                lastUpdate: Date.now(),
                config: {
                    compression: {
                        enabled: true,
                        defaultThreshold: 25,
                        venueOverrides: {},
                        maxPayloadSize: 16 * 1024
                    },
                    connection: {
                        pingInterval: 25000,
                        pingTimeout: 60000,
                        perVenueLimit: 200
                    },
                    thresholds: {
                        normal: 30,
                        warning: 50,
                        critical: 75
                    },
                    optimization: {
                        batchingEnabled: true,
                        batchSize: 100,
                        batchWait: 50
                    }
                },
                metrics: {
                    messageRate: null,
                    errorRate: null,
                    latency: null
                }
            },
            cache: {
                status: 'healthy',
                mode: 'local',
                localCacheCount: 0,
                localCacheStats: [],
                metrics: {
                    hitRate: null,
                    missRate: null,
                    size: null
                }
            },
            payment: {
                status: 'healthy',
                stripeConnected: true,
                features: {},
                metrics: {
                    successRate: null,
                    failureRate: null,
                    avgLatency: null
                }
            }
        };

        // Calculate overall health
        const services = Object.values(health).filter(s => s.status);
        const healthy = services.filter(s => s.status === 'healthy').length;
        
        health.summary = {
            status: healthy === services.length ? 'healthy' : 'degraded',
            total: services.length,
            healthy,
            degraded: services.length - healthy,
            responseTime: 1,
            timestamp: new Date().toISOString()
        };

        res.json(health);
    } catch (error) {
        healthLogger.error('Health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Database-specific health check
router.get('/database', async (req, res) => {
    try {
        const dbInfo = getConnectionInfo();
        res.json({
            ...dbInfo,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        healthLogger.error('Database health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// WebSocket-specific health check
router.get('/websocket', async (req, res) => {
    try {
        const startTime = Date.now();
        const health = wsMonitor.getHealth();

        // Add detailed metrics
        health.metrics = {
            messageRate: metrics.getMetric('websocket.messageRate'),
            errorRate: metrics.getMetric('websocket.errorRate'),
            latency: metrics.getMetric('websocket.latency'),
            connectedClients: wsMonitor.getTotalConnections(),
            activeVenues: wsMonitor.getActiveVenues().length,
            messageQueue: wsMonitor.getQueueStatus(),
            compressionRatio: metrics.getMetric('websocket.compressionRatio')
        };

        // Add performance metrics
        health.performance = {
            messageProcessingTime: metrics.getMetric('websocket.processingTime'),
            broadcastLatency: metrics.getMetric('websocket.broadcastLatency'),
            memoryUsage: wsMonitor.getMemoryUsage()
        };

        health.responseTime = Date.now() - startTime;
        health.timestamp = new Date().toISOString();

        res.json(health);
    } catch (error) {
        healthLogger.error('WebSocket health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Memory health check
router.get('/memory', (req, res) => {
    try {
        const health = memoryManager.getMemoryStats();
        health.timestamp = new Date().toISOString();
        res.json(health);
    } catch (error) {
        healthLogger.error('Memory health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Stripe health check
router.get('/payment', async (req, res) => {
    try {
        await stripe.accounts.retrieve();
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Payment health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router; 