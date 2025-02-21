// Add module alias registration at the start
require('module-alias/register');

// Load environment configuration first
const { config } = require('./config/environment.cjs');
const { app, initializeServices } = require('./app.cjs');
const http = require('http');
const logger = require('./utils/logger.cjs');
const { connect } = require('./config/database.cjs');

// Create specialized logger
const serverLogger = logger.child({
    context: 'server',
    service: 'http-server'
});

// Create HTTP server
const server = http.createServer(app);

// Start server
const PORT = process.env.PORT || 3000;

// Initialize services before starting server
async function startServer() {
    try {
        // Connect to MongoDB first
        await connect();
        
        // Initialize services
        const initialized = await initializeServices();
        
        if (!initialized && process.env.NODE_ENV === 'production') {
            throw new Error('Failed to initialize services in production');
        }

        // Start server
        server.listen(PORT, () => {
            serverLogger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
        });

        // Handle server errors
        server.on('error', (error) => {
            serverLogger.error('Server error:', error);
            process.exit(1);
        });

    } catch (error) {
        serverLogger.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Start server
startServer();

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    serverLogger.error('Uncaught Exception:', {
        error: error.message,
        stack: error.stack
    });
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    serverLogger.error('Unhandled Rejection:', {
        reason: reason.message,
        stack: reason.stack
    });
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
});

module.exports = { app, server }; 