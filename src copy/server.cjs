// Add module alias registration at the start
require('module-alias/register');

// Load environment configuration first
const { config } = require('./config/environment.cjs');
const { app } = require('./app.cjs');
const http = require('http');
const { connectDB } = require('./config/database.cjs');
const { initialize: initializeIO } = require('./utils/io.cjs');
const net = require('net');
const mongoose = require('mongoose');
const { startCleanupJobs } = require('./jobs/cleanupJobs.cjs');
const logger = require('./utils/logger.cjs');
const AuthenticationService = require('./services/auth/AuthenticationService.cjs');

// Create specialized server logger
const serverLogger = logger.child({
    context: 'server',
    service: 'http-server'
});

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
const isPortAvailable = (port) => new Promise((resolve) => {
    const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
            tester.once('close', () => resolve(true))
                .close();
        })
        .listen(port);
});

// Find next available port
const findAvailablePort = async (startPort) => {
    let port = startPort;
    while (!(await isPortAvailable(port))) {
        port++;
    }
    return port;
};

// Cleanup function
const cleanup = (server) => {
    return new Promise((resolve) => {
        server.close(() => {
            serverLogger.info('Server shutdown complete');
            resolve();
        });
    });
};

// Start server with proper error handling
const startServer = async () => {
    try {
        // Initialize MongoDB connection
        const dbConnection = await connectDB();
        if (!dbConnection && process.env.NODE_ENV === 'production') {
            throw new Error('Failed to connect to MongoDB in production');
        }
        serverLogger.info('MongoDB connected successfully');
        
        // Start cleanup jobs
        await startCleanupJobs();
        serverLogger.info('Cleanup jobs started');

        // Wait for services to be ready
        const initializeServices = require('./app.cjs').initializeServices;
        await initializeServices();
        serverLogger.info('Services initialized');

        // Verify auth service is ready
        const authService = AuthenticationService;
        if (!authService.isReady() && process.env.NODE_ENV === 'production') {
            throw new Error('Authentication service not ready in production');
        }
        
        // Use configured port and host
        const port = normalizePort(process.env.PORT || config.server.primary.port);
        const host = config.server.primary.host;
        
        // Initialize Socket.IO after services are ready
        await initializeIO(server);
        serverLogger.info('Socket.IO initialized');
        
        // Start the server with explicit host binding
        server.listen(port, host, () => {
            serverLogger.info('Server started', {
                port,
                host,
                environment: process.env.NODE_ENV,
                nodeVersion: process.version,
                pid: process.pid,
                auth: authService.getHealth()
            });
        });

        // Graceful shutdown
        const shutdown = async () => {
            serverLogger.info('Initiating graceful shutdown', {
                pid: process.pid,
                uptime: process.uptime()
            });
            
            await new Promise((resolve) => {
                server.close(resolve);
            });
            
            await mongoose.connection.close();
            
            serverLogger.info('Graceful shutdown completed', {
                cleanupTime: Date.now(),
                connections: server.connections
            });
            process.exit(0);
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

        return server;
    } catch (error) {
        serverLogger.error('Server startup failed', {
            error: error.message,
            stack: error.stack,
            config: {
                port: config.server.primary.port,
                environment: process.env.NODE_ENV
            }
        });
        process.exit(1);
    }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    serverLogger.error('Unhandled Promise Rejection', {
        error: err.message,
        stack: err.stack,
        type: err.name
    });
    // Don't exit in development
    if (process.env.NODE_ENV === 'production') {
        server.close(() => process.exit(1));
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    serverLogger.error('Uncaught Exception', {
        error: err.message,
        stack: err.stack,
        type: err.name
    });
    // Don't exit in development
    if (process.env.NODE_ENV === 'production') {
        server.close(() => process.exit(1));
    }
});

// Start the server
if (require.main === module) {
    startServer();
}

module.exports = { startServer }; 