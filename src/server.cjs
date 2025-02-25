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
const { monitoringMiddleware, metricsEndpoint } = require('./middleware/monitoring.cjs');
const { errorHandler } = require('./middleware/errorMiddleware.cjs');
const { securityHeaders } = require('./middleware/securityMiddleware.cjs');
const { configureRoutes } = require('./config/routes.cjs');
const { requireAuth } = require('./middleware/authMiddleware.cjs');
const wsMonitor = require('./utils/websocketMonitor.cjs');
const eventEmitter = require('./utils/eventEmitter.cjs');
const featureManager = require('./services/core/FeatureManager.cjs');
const monitoringDashboard = require('./utils/monitoringDashboard.cjs');
const connectDB = require('./config/database.cjs').connectDB;
const cacheService = require('./services/cacheService.cjs');
const logger = require('./utils/logger.cjs');
const net = require('net');
const mongoose = require('mongoose');
const path = require('path');

// Create specialized app logger
const appLogger = logger.child({
    context: 'app',
    service: 'express-app'
});

const app = express();

// Initialize core services
let servicesInitialized = false;

async function initializeServices() {
    if (servicesInitialized) return true;

    try {
        // 1. Initialize event system first
        await eventEmitter.initialize();
        appLogger.info('Event system initialized');

        // 2. Initialize cache service with retry
        let cacheInitialized = false;
        let cacheRetries = 0;
        while (!cacheInitialized && cacheRetries < 3) {
            try {
                await cacheService.initialize();
                cacheInitialized = true;
                appLogger.info('Cache service initialized');
            } catch (error) {
                cacheRetries++;
                appLogger.warn(`Cache initialization attempt ${cacheRetries} failed:`, error);
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, cacheRetries) * 1000));
            }
        }
        if (!cacheInitialized) {
            throw new Error('Failed to initialize cache service');
        }

        // 3. Initialize database connection with retry
        let dbInitialized = false;
        let dbRetries = 0;
        while (!dbInitialized && dbRetries < 3) {
            try {
                const dbConnection = await connectDB();
                if (!dbConnection && process.env.NODE_ENV === 'production') {
                    throw new Error('Failed to connect to MongoDB in production');
                }
                dbInitialized = true;
                appLogger.info('Database connection initialized');
            } catch (error) {
                dbRetries++;
                appLogger.warn(`Database initialization attempt ${dbRetries} failed:`, error);
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, dbRetries) * 1000));
            }
        }
        if (!dbInitialized) {
            throw new Error('Failed to initialize database connection');
        }

        // 4. Initialize feature manager with dependencies
        await featureManager.initialize({
            dependencies: {
                cache: cacheService,
                events: eventEmitter
            }
        });
        appLogger.info('Feature manager initialized');

        // 5. Initialize auth service with dependencies
        const AuthenticationService = require('./services/auth/AuthenticationService.cjs');
        await AuthenticationService.initialize({
            dependencies: {
                cache: cacheService,
                events: eventEmitter,
                features: featureManager
            }
        });
        appLogger.info('Authentication service initialized');

        // 6. Initialize WebSocket monitor with dependencies
        await wsMonitor.initialize({
            dependencies: {
                events: eventEmitter,
                cache: cacheService,
                features: featureManager
            }
        });
        appLogger.info('WebSocket monitor initialized');

        // 7. Initialize monitoring with all dependencies
        await monitoringDashboard.initialize({
            dependencies: {
                events: eventEmitter,
                cache: cacheService,
                wsMonitor: wsMonitor,
                features: featureManager,
                auth: AuthenticationService
            }
        });
        appLogger.info('Monitoring dashboard initialized');

        servicesInitialized = true;
        return true;
    } catch (error) {
        appLogger.error('Service initialization failed:', {
            error: error.message,
            stack: error.stack
        });
        
        // In development, we can continue with degraded functionality
        if (process.env.NODE_ENV !== 'production') {
            servicesInitialized = true;
            return false;
        }
        
        throw error;
    }
}

// Mount core middleware
app.use(cors());
// Configure helmet to allow static files
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(timeout('30s'));
app.use(securityHeaders);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Mount monitoring middleware early
app.use(monitoringMiddleware);

// Mount metrics endpoint (no auth required)
app.use('/metrics', metricsEndpoint);

// Mount health routes first (no auth required)
app.use('/health', require('./routes/healthRoutes.cjs'));

// Inject feature manager into requests
app.use((req, res, next) => {
    req.features = featureManager;
    next();
});

// Configure other routes
configureRoutes(app);

// Phase 5: Error handling
app.use(errorHandler);

// Create HTTP server
const server = http.createServer(app);

// Normalize port value
const normalizePort = (val) => {
    const port = parseInt(val, 10);
    if (isNaN(port)) return val;
    if (port >= 0) return port;
    return false;
};

// Check if port is in use
const isPortAvailable = (port) => {
    return new Promise((resolve) => {
        const tester = net.createServer()
            .once('error', () => resolve(false))
            .once('listening', () => {
                tester.once('close', () => resolve(true))
                    .close();
            })
            .listen(port);
    });
};

// Find next available port
const findAvailablePort = async (startPort) => {
    let port = startPort;
    const maxAttempts = 10; // Try up to 10 ports
    let attempts = 0;

    while (attempts < maxAttempts) {
        const available = await isPortAvailable(port);
        if (available) {
            return port;
        }
        port++;
        attempts++;
    }
    throw new Error(`No available ports found after ${maxAttempts} attempts starting from ${startPort}`);
};

// Cleanup function for graceful shutdown
const cleanup = async () => {
    appLogger.info('Initiating graceful shutdown', {
        pid: process.pid,
        uptime: process.uptime()
    });

    // Close server first to stop accepting new connections
    await new Promise((resolve) => {
        server.close(resolve);
    });

    // Close database connection
    if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        appLogger.info('Database connection closed');
    }

    // Cleanup WebSocket connections if any
    if (wsMonitor && typeof wsMonitor.cleanup === 'function') {
        await wsMonitor.cleanup();
        appLogger.info('WebSocket connections cleaned up');
    }

    appLogger.info('Graceful shutdown completed', {
        cleanupTime: Date.now(),
        connections: server.connections
    });
};

// Start server with proper error handling
const startServer = async () => {
    try {
        // Get configured port
        let PORT = process.env.PORT || 3001;
        
        // Check port availability and find next available if needed
        if (!await isPortAvailable(PORT)) {
            appLogger.warn(`Port ${PORT} is in use, searching for next available port...`);
            try {
                PORT = await findAvailablePort(PORT + 1);
                appLogger.info(`Found available port: ${PORT}`);
            } catch (error) {
                throw new Error(`Failed to find available port: ${error.message}`);
            }
        }

        // Initialize services with retry logic
        let servicesInitialized = false;
        const maxRetries = 3;
        let retryCount = 0;

        while (!servicesInitialized && retryCount < maxRetries) {
            try {
                await initializeServices();
                servicesInitialized = true;
                appLogger.info('Services initialized successfully');
            } catch (error) {
                retryCount++;
                appLogger.warn(`Service initialization attempt ${retryCount} failed:`, {
                    error: error.message,
                    retryCount,
                    maxRetries
                });
                
                if (retryCount === maxRetries) {
                    throw new Error(`Service initialization failed after ${maxRetries} attempts: ${error.message}`);
                }
                
                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
            }
        }

        // Start server with explicit host binding
        server.listen(PORT, '0.0.0.0', () => {
            appLogger.info('Server started', {
                port: PORT,
                environment: process.env.NODE_ENV,
                nodeVersion: process.version,
                pid: process.pid,
                servicesStatus: {
                    initialized: servicesInitialized,
                    retryCount
                }
            });
        });

        // Handle server errors
        server.on('error', (error) => {
            if (error.syscall !== 'listen') {
                throw error;
            }

            const bind = typeof PORT === 'string'
                ? 'Pipe ' + PORT
                : 'Port ' + PORT;

            switch (error.code) {
                case 'EACCES':
                    appLogger.error(`${bind} requires elevated privileges`);
                    process.exit(1);
                    break;
                case 'EADDRINUSE':
                    appLogger.error(`${bind} is already in use`);
                    process.exit(1);
                    break;
                default:
                    throw error;
            }
        });

        // Setup graceful shutdown handlers
        process.on('SIGTERM', cleanup);
        process.on('SIGINT', cleanup);

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (err) => {
            appLogger.error('Unhandled Promise Rejection', {
                error: err.message,
                stack: err.stack,
                type: err.name
            });
            if (process.env.NODE_ENV === 'production') {
                cleanup().then(() => process.exit(1));
            }
        });

    } catch (error) {
        appLogger.error('Server startup failed', {
            error: error.message,
            stack: error.stack,
            config: {
                port: PORT,
                environment: process.env.NODE_ENV
            }
        });
        process.exit(1);
    }
};

// Replace the existing server.listen call with startServer
startServer().catch(error => {
    appLogger.error('Failed to start server', {
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
});

module.exports = { app, server }; 