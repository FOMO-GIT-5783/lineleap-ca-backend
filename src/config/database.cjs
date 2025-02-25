const mongoose = require('mongoose');
const logger = require('../utils/logger.cjs');
const { config } = require('./environment.cjs');

// Connection state mapping
const CONNECTION_STATES = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
};

const getConnectionState = () => {
    return CONNECTION_STATES[mongoose.connection.readyState] || 'unknown';
};

const connectDB = async () => {
    const options = {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4,
        retryWrites: true,
        w: 'majority',
        appName: 'FOMO-API',
        connectTimeoutMS: 30000,
        heartbeatFrequencyMS: 10000
    };

    try {
        const conn = await mongoose.connect(config.database.uri, options);
        logger.info(`MongoDB Connected: ${conn.connection.host}`);
        
        // Handle connection events
        mongoose.connection.on('connected', () => {
            logger.info('Mongoose connected to MongoDB Atlas');
        });

        mongoose.connection.on('error', (err) => {
            logger.error('Mongoose connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('Mongoose disconnected from MongoDB Atlas');
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            logger.info('Mongoose disconnected through app termination');
            process.exit(0);
        });

        return conn;
    } catch (error) {
        logger.error('MongoDB connection error:', error);
        // In development, continue with degraded functionality
        if (process.env.NODE_ENV === 'development') {
            logger.warn('Development mode: Continuing with degraded functionality');
            return null;
        }
        process.exit(1);
    }
};

module.exports = { 
    connectDB,
    getConnectionState,
    CONNECTION_STATES
};

