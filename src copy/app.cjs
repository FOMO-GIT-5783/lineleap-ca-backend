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

async function initializeServices() {
    if (servicesInitialized) {
        return;
    }

    try {
        // 1. Initialize event system first
        const eventEmitter = require('./utils/eventEmitter.cjs');
        await eventEmitter.initialize();
        appLogger.info('Event system initialized');

        // 2. Initialize cache service
        await cacheService.initialize();
        appLogger.info('Cache service initialized');

        // 3. Initialize database connection
        const dbConnection = await connectDB();
        if (!dbConnection && process.env.NODE_ENV === 'production') {
            throw new Error('Failed to connect to MongoDB in production');
        }
        appLogger.info('Database connection initialized');

        // 4. Initialize feature manager (depends on cache and events)
        await FeatureManager.initialize({
            dependencies: {
                cache: cacheService,
                events: eventEmitter
            }
        });
        appLogger.info('Feature manager initialized');

        // 5. Initialize auth service (depends on features, cache, events)
        await AuthenticationService.initialize({
            dependencies: {
                cache: cacheService,
                events: eventEmitter,
                features: FeatureManager
            }
        });
        appLogger.info('Authentication service initialized');

        // 6. Initialize WebSocket monitor (depends on events)
        const wsMonitor = require('./utils/websocketMonitor.cjs');
        await wsMonitor.initialize({
            dependencies: {
                events: eventEmitter,
                cache: cacheService
            }
        });
        appLogger.info('WebSocket monitor initialized');

        // 7. Initialize payment services
        await PaymentProcessor.initialize({
            dependencies: {
                cache: cacheService,
                events: eventEmitter,
                auth: AuthenticationService
            }
        });
        appLogger.info('Payment processor initialized');

        // 8. Initialize monitoring last
        await monitoringDashboard.initialize({
            dependencies: {
                events: eventEmitter,
                cache: cacheService,
                auth: AuthenticationService,
                wsMonitor: wsMonitor
            }
        });
        appLogger.info('Monitoring dashboard initialized');

        servicesInitialized = true;
        appLogger.info('All services initialized successfully');

        return true;
    } catch (error) {
        appLogger.error('Service initialization failed:', {
            error: error.message,
            stack: error.stack
        });
        
        if (process.env.NODE_ENV === 'production') {
            throw error;
        }
        
        // In development, continue with degraded functionality
        servicesInitialized = true;
        return false;
    }
}

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

// Ensure services are initialized before handling requests
app.use(async (req, res, next) => {
    if (!servicesInitialized) {
        try {
            await initializeServices();
            next();
        } catch (error) {
            next(error);
        }
    } else {
        next();
    }
});

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

module.exports = { app, initializeServices }; 