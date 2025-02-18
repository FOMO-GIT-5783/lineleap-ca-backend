const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { stripe } = require('../config/stripeConfig.cjs');
const logger = require('../utils/logger.cjs');
const wsMonitor = require('../utils/websocketMonitor.cjs');
const optimizationManager = require('../utils/optimizationManager.cjs');
const cacheService = require('../services/cacheService.cjs');
const featureManager = require('../services/payment/FeatureManager.cjs');
const PaymentProcessor = require('../services/payment/PaymentProcessor.cjs');
const AuthenticationService = require('../services/auth/AuthenticationService.cjs');
const WebSocketMonitor = require('../utils/websocketMonitor.cjs');
const PaymentSecurity = require('../services/payment/PaymentSecurity.cjs');
const { getConnectionState } = require('../config/database.cjs');
const redisClient = require('../utils/redisClient.cjs');

// Create specialized logger
const healthLogger = logger.child({
    context: 'health',
    service: 'health-check'
});

// Circuit breaker thresholds
const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT = 60000; // 1 minute

// Initialize circuit breakers if not exists
if (!global.circuitBreakers) {
    global.circuitBreakers = {
        stripe: { status: 'closed', failures: 0, lastCheck: Date.now() },
        database: { status: 'closed', failures: 0, lastCheck: Date.now() }
    };
}

// Basic health check
router.get('/', async (req, res) => {
    try {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV,
            services: {}
        };

        // Check WebSocket health
        try {
            const wsMonitor = WebSocketMonitor;
            const wsHealth = await wsMonitor.getHealth();
            health.services.websocket = {
                status: wsHealth.status,
                totalConnections: wsHealth.totalConnections,
                activeVenues: wsHealth.activeVenues,
                venueSessions: wsHealth.venueSessions
            };
        } catch (error) {
            health.services.websocket = {
                status: 'unhealthy',
                error: error.message
            };
            health.status = 'degraded';
        }

        // Check Auth service health
        try {
            const authService = AuthenticationService;
            const authHealth = await authService.getHealth();
            health.services.auth = authHealth;
        } catch (error) {
            health.services.auth = {
                status: 'unhealthy',
                error: error.message
            };
            health.status = 'degraded';
        }

        // Check MongoDB health
        try {
            const dbState = getConnectionState();
            const dbAdmin = mongoose.connection.db.admin();
            const serverStatus = await dbAdmin.serverStatus();
            
            health.services.database = {
                status: dbState === 'connected' ? 'healthy' : 'unhealthy',
                state: dbState,
                connections: serverStatus.connections,
                opCounters: serverStatus.opcounters,
                metrics: {
                    activeConnections: serverStatus.connections.current,
                    availableConnections: serverStatus.connections.available,
                    totalOperations: Object.values(serverStatus.opcounters).reduce((a, b) => a + b, 0)
                }
            };

            if (dbState !== 'connected') {
                health.status = 'degraded';
            }
        } catch (error) {
            health.services.database = {
                status: 'unhealthy',
                error: error.message
            };
            health.status = 'degraded';
        }

        // Check Redis health (if used)
        try {
            const redisStatus = await redisClient.getClient()?.ping();
            health.services.redis = {
                status: redisStatus === 'PONG' ? 'healthy' : 'unhealthy',
                connected: !!redisClient.getClient()?.status
            };

            if (redisStatus !== 'PONG') {
                health.status = 'degraded';
            }
        } catch (error) {
            health.services.redis = {
                status: 'unhealthy',
                error: error.message
            };
            // Only degrade if we're in production (Redis optional in dev)
            if (process.env.NODE_ENV === 'production') {
                health.status = 'degraded';
            }
        }

        // Check Stripe health
        try {
            const stripeBalance = await stripe.balance.retrieve();
            const paymentSecurity = PaymentSecurity;
            const securityHealth = paymentSecurity.getHealth();

            health.services.payments = {
                status: 'healthy',
                stripe: {
                    status: 'healthy',
                    available: stripeBalance.available.map(b => ({
                        amount: b.amount,
                        currency: b.currency
                    }))
                },
                security: securityHealth,
                rateLimits: securityHealth.rateLimits
            };
        } catch (error) {
            health.services.payments = {
                status: 'unhealthy',
                error: error.message
            };
            health.status = 'degraded';
        }

        // Check system resources
        const systemHealth = {
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            cpu: process.cpuUsage(),
            timestamp: Date.now()
        };

        // Check for memory issues
        const memoryUsagePercent = (systemHealth.memory.heapUsed / systemHealth.memory.heapTotal) * 100;
        if (memoryUsagePercent > 85) {
            health.status = 'degraded';
            systemHealth.warnings = ['High memory usage'];
        }

        health.system = systemHealth;

        // Log health check
        healthLogger.info('Detailed health check performed', {
            health
        });

        // Set appropriate status code
        const statusCode = health.status === 'healthy' ? 200 : 
                          health.status === 'degraded' ? 207 : 503;

        res.status(statusCode).json(health);
    } catch (error) {
        healthLogger.error('Health check failed:', error);
        res.status(500).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Detailed WebSocket health check
router.get('/websocket', async (req, res) => {
    try {
        const wsMonitor = WebSocketMonitor;
        const health = await wsMonitor.getDetailedHealth();
        
        // Add venue-specific metrics if requested
        if (req.query.venueId) {
            health.venueMetrics = await wsMonitor.getVenueMetrics(req.query.venueId);
        }

        healthLogger.info('WebSocket health check performed', {
            health
        });

        res.json(health);
    } catch (error) {
        healthLogger.error('WebSocket health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            service: 'websocket'
        });
    }
});

// Auth health check
router.get('/auth', async (req, res) => {
    try {
        const authService = AuthenticationService;
        if (!authService.isReady()) {
            throw new Error('Authentication service not ready');
        }

        const health = await authService.getHealth();
        
        healthLogger.info('Auth health check performed', {
            status: health
        });

        res.json(health);
    } catch (error) {
        healthLogger.error('Auth health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            service: 'auth-service'
        });
    }
});

// Database health check
router.get('/database', async (req, res) => {
    try {
        const dbState = getConnectionState();
        const dbAdmin = mongoose.connection.db.admin();
        const [serverStatus, dbStats] = await Promise.all([
            dbAdmin.serverStatus(),
            mongoose.connection.db.stats()
        ]);

        const health = {
            status: dbState === 'connected' ? 'healthy' : 'unhealthy',
            state: dbState,
            metrics: {
                connections: serverStatus.connections,
                operations: serverStatus.opcounters,
                memory: serverStatus.mem,
                documents: dbStats.objects,
                dataSize: dbStats.dataSize,
                indexes: dbStats.indexes,
                indexSize: dbStats.indexSize
            },
            performance: {
                activeConnections: serverStatus.connections.current,
                availableConnections: serverStatus.connections.available,
                queuedOperations: serverStatus.globalLock?.currentQueue?.total || 0,
                slowQueries: serverStatus.metrics?.commands?.find?.slow || 0
            }
        };

        healthLogger.info('Database health check performed', { health });
        res.json(health);
    } catch (error) {
        healthLogger.error('Database health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            service: 'database'
        });
    }
});

// Payment system health check
router.get('/payments', async (req, res) => {
    try {
        const [stripeBalance, paymentSecurity] = await Promise.all([
            stripe.balance.retrieve(),
            PaymentSecurity.getHealth()
        ]);

        const health = {
            status: 'healthy',
            stripe: {
                status: 'healthy',
                balance: {
                    available: stripeBalance.available,
                    pending: stripeBalance.pending
                }
            },
            security: paymentSecurity,
            rateLimits: {
                current: paymentSecurity.rateLimits,
                configuration: {
                    api: stripe.getMaxNetworkRetries(),
                    idempotency: stripe.getMaxNetworkRetries()
                }
            }
        };

        healthLogger.info('Payment system health check performed', { health });
        res.json(health);
    } catch (error) {
        healthLogger.error('Payment system health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            service: 'payments'
        });
    }
});

// Circuit breaker functions
function checkCircuitBreaker(service) {
    const breaker = global.circuitBreakers?.[service] || {
        status: 'closed',
        failures: 0,
        lastCheck: Date.now()
    };

    // Auto-reset after timeout
    if (breaker.status === 'open' && Date.now() - breaker.lastCheck > RESET_TIMEOUT) {
        breaker.status = 'half-open';
        breaker.failures = 0;
    }

    return breaker;
}

function updateCircuitBreaker(service, success) {
    const breaker = global.circuitBreakers?.[service];
    if (!breaker) return;

    breaker.lastCheck = Date.now();

    if (success) {
        if (breaker.status === 'half-open') {
            breaker.status = 'closed';
        }
        breaker.failures = 0;
    } else {
        breaker.failures++;
        if (breaker.failures >= FAILURE_THRESHOLD) {
            breaker.status = 'open';
        }
    }
}

module.exports = router; 