const mongoose = require('mongoose');
const logger = require('../utils/logger.cjs');
const { config } = require('./environment.cjs');

// Create specialized logger for database operations
const dbLogger = logger.child({
    context: 'database',
    service: 'mongodb'
});

// Connection states for monitoring
const CONNECTION_STATES = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
};

// Handle mongoose version compatibility
// Mongoose 6.x specific settings
mongoose.set('strictQuery', true);  // Prepare for Mongoose 7 while staying on 6.x

// Enable mongoose debug logging in development
if (process.env.NODE_ENV === 'development') {
    mongoose.set('debug', (collectionName, method, query, doc) => {
        dbLogger.debug(`Mongoose: ${collectionName}.${method}`, {
            query,
            doc: doc ? 'doc-present' : 'no-doc'
        });
    });
}

// Track connection state
let isConnecting = false;
let connectionInstance = null;
let lastError = null;
let reconnectTimeout = null;
let pendingConnection = null;  // Add this to track pending connection promise

// Unified connection options
const CONNECTION_OPTIONS = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    w: 'majority',
    family: 4,
    authSource: 'admin',
    retryReads: true,
    serverApi: { version: '1', strict: false },
    readPreference: 'primaryPreferred',
    replicaSet: 'atlas-16pj38-shard-0'
};

// Document connection options for clarity
const CONNECTION_OPTION_DOCS = {
    maxPoolSize: '10 connections - sufficient for 10 venues with 2-3 concurrent ops each',
    serverSelectionTimeoutMS: '30 seconds - matches our verification script timeout',
    retryWrites: 'Enabled for write operation reliability',
    retryReads: 'Enabled for read operation reliability',
    authSource: 'Required for Atlas authentication'
};

// Single point of reconnection scheduling
const scheduleReconnect = () => {
    if (reconnectTimeout) return;
    
    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        if (!isConnecting && connectionInstance?.connection?.readyState !== 1) {
            connect().catch(err => {
                dbLogger.error('Reconnection failed:', {
                    error: err.message,
                    code: err.code
                });
            });
        }
    }, 5000);
};

// Track event handlers for cleanup
const eventHandlers = {
    connected: (conn) => {
        try {
            dbLogger.info('MongoDB connected', {
                host: conn?.connection?.host || 'unknown',
                database: conn?.connection?.name || 'unknown',
                state: CONNECTION_STATES[conn?.connection?.readyState] || 'unknown'
            });
            connectionInstance = conn;
            lastError = null;
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        } catch (error) {
            dbLogger.error('Error in connected handler:', error);
        }
    },
    error: (error) => {
        dbLogger.error('Mongoose connection error:', {
            error: error.message,
            code: error.code,
            state: CONNECTION_STATES[mongoose.connection.readyState]
        });
    },
    disconnected: () => {
        const prevState = CONNECTION_STATES[mongoose.connection.readyState];
        dbLogger.warn('Mongoose disconnected', {
            previousState: prevState,
            timestamp: new Date().toISOString()
        });
        
        // Only trigger reconnection if we were previously connected
        // and we're in development mode
        if (connectionInstance && process.env.NODE_ENV === 'development') {
            connectionInstance = null;
            scheduleReconnect();  // Use single reconnection point
        }
    }
};

// Remove existing event handlers
mongoose.connection.removeAllListeners('connected');
mongoose.connection.removeAllListeners('error');
mongoose.connection.removeAllListeners('disconnected');

// Set up event handlers once
mongoose.connection.on('connected', eventHandlers.connected);
mongoose.connection.on('error', eventHandlers.error);
mongoose.connection.on('disconnected', eventHandlers.disconnected);

const connect = async () => {
    if (isConnecting) {
        dbLogger.warn('Connection attempt already in progress');
        return pendingConnection;
    }

    try {
        isConnecting = true;
        dbLogger.info('Starting MongoDB connection process', {
            uri: config.database.uri?.replace(/(mongodb\+srv:\/\/)([^@]+)@/, '$1***:***@'),
            environment: process.env.NODE_ENV,
            options: CONNECTION_OPTIONS
        });

        // Create the connection
        connectionInstance = await mongoose.connect(config.database.uri, CONNECTION_OPTIONS);
        
        // Log successful connection
        dbLogger.info('MongoDB Connected', {
            host: connectionInstance.connection.host,
            database: connectionInstance.connection.name,
            state: CONNECTION_STATES[connectionInstance.connection.readyState]
        });

        // Reset error state
        lastError = null;
        
        return connectionInstance;
    } catch (error) {
        const errorMessage = error.message || 'Unknown error';
        const errorCode = error.code || 'NO_CODE';
        
        lastError = {
            message: errorMessage,
            code: errorCode,
            timestamp: new Date().toISOString()
        };

        dbLogger.error('MongoDB connection failed:', {
            error: errorMessage,
            code: errorCode,
            context: {
                state: mongoose.connection.readyState,
                hasConnection: !!connectionInstance,
                environment: process.env.NODE_ENV
            }
        });

        connectionInstance = null;
        throw error;
    } finally {
        isConnecting = false;
        pendingConnection = null;
    }
};

// Update graceful shutdown to include event handler cleanup
process.on('SIGINT', async () => {
    try {
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        
        // Clean up event handlers
        mongoose.connection.removeListener('connected', eventHandlers.connected);
        mongoose.connection.removeListener('error', eventHandlers.error);
        mongoose.connection.removeListener('disconnected', eventHandlers.disconnected);
        
        if (connectionInstance) {
            await connectionInstance.connection.close();
            dbLogger.info('MongoDB connection closed through app termination');
        }
        
        process.exit(0);
    } catch (error) {
        dbLogger.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
});

// Health check helper
const getConnectionInfo = () => {
    return {
        status: connectionInstance?.connection?.readyState === 1 ? 'healthy' : 'unhealthy',
        state: CONNECTION_STATES[connectionInstance?.connection?.readyState] || 'unknown',
        lastError,
        timestamp: new Date().toISOString()
    };
};

module.exports = {
    connect,
    getConnectionInfo,
    CONNECTION_STATES
};

