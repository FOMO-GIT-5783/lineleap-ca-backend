// Add module alias registration at the start
require('module-alias/register');

// Load environment configuration first
const { config } = require('./config/environment.cjs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const timeout = require('connect-timeout');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middleware/errorMiddleware.cjs');
const { securityHeaders } = require('./middleware/securityMiddleware.cjs');
const { configureRoutes } = require('./config/routes.cjs');
const { requireAuth } = require('./middleware/authMiddleware.cjs');
const { monitoringMiddleware } = require('./middleware/monitoring.cjs');
const wsMonitor = require('./utils/websocketMonitor.cjs');
const eventEmitter = require('./utils/eventEmitter.cjs');
const optimizationManager = require('./utils/optimizationManager.cjs');
const monitoringDashboard = require('./utils/monitoringDashboard.cjs');
const PaymentProcessor = require('./services/payment/PaymentProcessor.cjs');
const PaymentEventEmitter = require('./services/payment/PaymentEventEmitter.cjs');
const PaymentMetrics = require('./services/payment/PaymentMetrics.cjs');
const TransactionManager = require('./services/payment/TransactionManager.cjs');
const connectDB = require('./config/database.cjs').connectDB;
const cacheService = require('./services/cacheService.cjs');
const logger = require('./utils/logger.cjs');
const AuthenticationService = require('./services/auth/AuthenticationService.cjs');
const FeatureManager = require('./services/payment/FeatureManager.cjs');

// Create specialized app logger
const appLogger = logger.child({
    context: 'app',
    service: 'express-app'
});

const app = express();

// Initialize core services
let servicesInitialized = false;
let dbConnection = null;
let initializationInProgress = null;  // Track initialization promise

// Categorize services by database dependency
const DB_REQUIRED_SERVICES = ['payment-processor', 'auth-service'];
const DB_OPTIONAL_SERVICES = ['monitoring-dashboard', 'cache-service'];

async function initializeServices() {
    // Return existing initialization if in progress
    if (initializationInProgress) {
        return initializationInProgress;
    }

    // Return early if already initialized
    if (servicesInitialized) {
        return true;
    }

    // Start initialization
    initializationInProgress = (async () => {
        try {
            // 1. Initialize database connection FIRST and wait for it
            appLogger.info('Initializing database connection...');
            dbConnection = await connectDB();

            // In production, we must have DB connection
            if (!dbConnection && process.env.NODE_ENV === 'production') {
                throw new Error('Failed to connect to MongoDB in production');
            }

            const hasDbConnection = !!dbConnection;
            
            if (!hasDbConnection) {
                appLogger.warn('Database connection not available', {
                    environment: process.env.NODE_ENV,
                    mode: 'limited'
                });
            } else {
                appLogger.info('Database connection successful', {
                    host: dbConnection.connection.host,
                    database: dbConnection.connection.name,
                    readyState: dbConnection.connection.readyState
                });
            }

            // 2. Initialize event system (no DB dependency)
            appLogger.info('Initializing event system...');
            await eventEmitter.initialize();
            appLogger.info('Event system initialized');

            // 3. Initialize cache service (no DB dependency)
            appLogger.info('Initializing cache service...');
            await cacheService.initialize();
            appLogger.info('Cache service initialized');

            // 4. Initialize monitoring (optional DB dependency)
            if (hasDbConnection || process.env.NODE_ENV === 'development') {
                appLogger.info('Initializing WebSocket monitor...');
                await wsMonitor.initialize({
                    dependencies: {
                        events: eventEmitter,
                        cache: cacheService
                    }
                });
                appLogger.info('WebSocket monitor initialized');

                appLogger.info('Initializing monitoring dashboard...');
                await monitoringDashboard.initialize({
                    dependencies: {
                        events: eventEmitter,
                        cache: cacheService,
                        wsMonitor: wsMonitor
                    }
                });
                appLogger.info('Monitoring dashboard initialized');
            }

            // 5. Initialize critical services (require DB)
            if (hasDbConnection) {
                appLogger.info('Initializing payment processor...');
                await PaymentProcessor.initialize({
                    dependencies: {
                        cache: cacheService,
                        events: eventEmitter
                    }
                });
                appLogger.info('Payment processor initialized');
            } else if (process.env.NODE_ENV === 'production') {
                throw new Error('Cannot initialize payment services without database connection');
            } else {
                appLogger.warn('Payment services not initialized - database connection required');
            }

            servicesInitialized = true;
            return true;
        } catch (error) {
            appLogger.error('Service initialization failed:', error);
            if (process.env.NODE_ENV === 'production') {
                throw error;
            }
            servicesInitialized = true;
            return false;
        } finally {
            initializationInProgress = null;
        }
    })();

    return initializationInProgress;
}

// Middleware to check service requirements
const checkServiceRequirements = (req, res, next) => {
    // Always allow health check endpoints
    if (req.path.startsWith('/health')) {
        return next();
    }

    // Check if path requires database
    const requiresDb = DB_REQUIRED_SERVICES.some(service => 
        req.path.includes(service.split('-')[0])
    );

    if (requiresDb && !dbConnection) {
        const error = new Error('Service unavailable - database connection required');
        error.status = 503;
        return next(error);
    }

    next();
};

// Middleware to ensure services are ready
const ensureServicesReady = async (req, res, next) => {
    // Always allow health checks
    if (req.path.startsWith('/health')) {
        return next();
    }

    try {
        // Wait for initialization if not ready
        if (!servicesInitialized) {
            await initializeServices();
        }

        // Check service requirements after initialization
        checkServiceRequirements(req, res, next);
    } catch (error) {
        next(error);
    }
};

// Phase 1: Base middleware
app.use(timeout(process.env.NODE_ENV === 'production' ? '30s' : '120s'));
app.use((req, res, next) => {
    if (!req.timedout) next();
});

// Add monitoring middleware early to capture all requests
app.use(monitoringMiddleware);

app.use(compression());

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        appLogger.info(`${req.method} ${req.originalUrl}`, {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration,
            ip: req.ip,
            userAgent: req.get('user-agent')
        });
    });
    next();
});

// Add service initialization check early in middleware chain
app.use(ensureServicesReady);

// Phase 2: Security middleware
app.use(helmet());
app.use(cors({
    origin: config.corsOrigins,
    credentials: true
}));
app.use(securityHeaders);

// Phase 3: Request parsing
app.use(express.json({
    verify: (req, res, buf) => {
        // Store raw body for webhook signature verification
        if (req.originalUrl.includes('/webhook')) {
            req.rawBody = buf;
        }
    }
}));
app.use(express.urlencoded({ extended: true }));

// Phase 4: Authentication
const gradualAuthMiddleware = require('./middleware/gradualAuthMiddleware.cjs');
app.use(gradualAuthMiddleware());

// Phase 5: Routes
configureRoutes(app);

// Phase 6: Error handling
app.use(errorHandler);

// Export for use in server.js
module.exports = { 
    app, 
    initializeServices,
    getDbConnection: () => dbConnection 
}; 