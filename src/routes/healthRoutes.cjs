const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const logger = require('../utils/logger.cjs');
const wsMonitor = require('../utils/websocketMonitor.cjs');
const cacheService = require('../services/cacheService.cjs');
const AuthenticationService = require('../services/auth/AuthenticationService.cjs');
const { getConnectionState } = require('../config/database.cjs');

// Create specialized logger
const healthLogger = logger.child({
    context: 'health',
    service: 'health-check'
});

// Basic health check for load balancers
router.get('/', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime()
    });
});

// Detailed health check endpoint
router.get('/detailed', async (req, res) => {
    try {
        const health = {
            server: {
                status: 'healthy',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                environment: process.env.NODE_ENV || 'development'
            }
        };

        // Add database health
        try {
            const dbState = getConnectionState();
            health.database = {
                status: dbState === 'connected' ? 'healthy' : 'unhealthy',
                state: dbState
            };
        } catch (error) {
            health.database = {
                status: 'unhealthy',
                error: error.message
            };
        }

        // Add auth health
        try {
            health.auth = await AuthenticationService.getHealth();
        } catch (error) {
            health.auth = {
                status: 'unhealthy',
                error: error.message
            };
        }

        // Add websocket health
        try {
            health.websocket = wsMonitor.getHealth();
        } catch (error) {
            health.websocket = {
                status: 'unhealthy',
                error: error.message
            };
        }

        // Add cache health
        try {
            health.cache = cacheService.getHealth();
        } catch (error) {
            health.cache = {
                status: 'unhealthy',
                error: error.message
            };
        }

        // Calculate overall status
        const healthyServices = Object.values(health).filter(
            service => service.status === 'healthy'
        ).length;
        const totalServices = Object.keys(health).length;

        const overallStatus = healthyServices === totalServices ? 'healthy' :
                            healthyServices === 0 ? 'unhealthy' : 'degraded';

        res.json({
            status: overallStatus,
            timestamp: new Date().toISOString(),
            services: health,
            summary: {
                total: totalServices,
                healthy: healthyServices,
                degraded: totalServices - healthyServices
            }
        });
    } catch (error) {
        healthLogger.error('Detailed health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Database health check
router.get('/database', async (req, res) => {
    try {
        const dbState = getConnectionState();
        const health = {
            status: dbState === 'connected' ? 'healthy' : 'unhealthy',
            state: dbState,
            timestamp: new Date().toISOString()
        };

        res.json(health);
    } catch (error) {
        healthLogger.error('Database health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// WebSocket health check
router.get('/websocket', (req, res) => {
    try {
        const health = wsMonitor.getHealth();
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

module.exports = router; 