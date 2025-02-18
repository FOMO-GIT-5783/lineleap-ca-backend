// Add module alias registration at the start
require('module-alias/register');

// Load environment configuration first
const { config } = require('./config/environment.cjs');
const express = require('express');
const http = require('http');
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

// Create specialized app logger
const appLogger = logger.child({
    context: 'app',
    service: 'express-app'
});

const app = express();

// Initialize core services
let servicesInitialized = false;

async function initializeServices() {
    if (servicesInitialized) return;

    try {
        // 1. Initialize event system first
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

        // 4. Initialize WebSocket monitor
        await wsMonitor.initialize({
            dependencies: {
                events: eventEmitter,
                cache: cacheService
            }
        });
        appLogger.info('WebSocket monitor initialized');

        // 5. Initialize payment services
        await PaymentProcessor.initialize({
            dependencies: {
                cache: cacheService,
                events: eventEmitter
            }
        });
        appLogger.info('Payment processor initialized');

        // 6. Initialize monitoring last
        await monitoringDashboard.initialize({
            dependencies: {
                events: eventEmitter,
                cache: cacheService,
                wsMonitor: wsMonitor
            }
        });
        appLogger.info('Monitoring dashboard initialized');

        servicesInitialized = true;
        return true;
    } catch (error) {
        appLogger.error('Service initialization failed:', error);
        if (process.env.NODE_ENV === 'production') throw error;
        servicesInitialized = true;
        return false;
    }
}

// Mount core middleware
app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(timeout('30s'));
app.use(securityHeaders);
app.use(monitoringMiddleware);

// Mount health routes first (no auth required)
app.use('/health', require('./routes/healthRoutes.cjs'));

// Configure other routes
configureRoutes(app);

// Phase 5: Error handling
app.use(errorHandler);

// Create HTTP server
const server = http.createServer(app);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    appLogger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    appLogger.error('Uncaught Exception:', {
        error: error.message,
        stack: error.stack
    });
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    appLogger.error('Unhandled Rejection:', {
        reason: reason.message,
        stack: reason.stack
    });
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
});

module.exports = { app, server }; 