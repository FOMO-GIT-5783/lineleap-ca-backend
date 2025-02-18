const mongoose = require('mongoose');

let cachedConnection = null;
let connectionState = 'disconnected';

const getConnectionOptions = () => {
    const isProd = process.env.NODE_ENV === 'production';
    const isSrvUrl = process.env.MONGODB_URI?.includes('+srv');

    // Basic options that work with both SRV and standard URIs
    const options = {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        heartbeatFrequencyMS: 5000,
        retryWrites: true,
        w: 'majority',
        maxPoolSize: 10,
        minPoolSize: 5,
        maxIdleTimeMS: 30000,
        family: 4,
        authSource: 'admin',
        retryReads: true
    };

    // Add SSL/TLS options only for production or SRV URIs
    if (isProd || isSrvUrl) {
        Object.assign(options, {
            ssl: true,
            tls: true
        });
    }

    // Add direct connection only for development and non-SRV URIs
    if (!isProd && !isSrvUrl) {
        options.directConnection = true;
    }

    return options;
};

mongoose.connection.on('connected', () => {
    connectionState = 'connected';
    console.info('MongoDB connected successfully');
});

mongoose.connection.on('error', (err) => {
    connectionState = 'error';
    console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    connectionState = 'disconnected';
    console.warn('MongoDB disconnected');
});

async function connectDB() {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not defined in environment variables');
        }

        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        return mongoose.connection;
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        
        if (process.env.NODE_ENV === 'development') {
            console.warn('Development mode: Continuing without database connection');
            connectionState = 'degraded';
            return null;
        }
        
        throw error;
    }
}

const getConnectionState = () => connectionState;

module.exports = {
    connectDB,
    getConnectionState,
    getConnectionOptions
};

