const mongoose = require('mongoose');
const logger = require('./logger.cjs');
const BaseService = require('./baseService.cjs');

// Halifax-specific configuration
const HALIFAX_CONFIG = {
    venues: 6,
    peakConnections: 150,
    normalConnections: 75,
    minPoolSize: {
        peak: 30,    // 20% of peak
        normal: 15   // 20% of normal
    },
    maxPoolSize: {
        peak: 180,   // 120% of peak for bursts
        normal: 90   // 120% of normal for bursts
    },
    peakHours: {
        start: 20,   // 8 PM
        end: 3       // 3 AM
    }
};

// Maintain singleton for backward compatibility
let instance = null;

class ConnectionManager extends BaseService {
    constructor(config = {}) {
        super('connection-manager');
        this.connections = new Map();
        this.retryTimers = new Map();
        this.config = {
            maxRetries: 3,
            retryDelay: 5000,
            ...config
        };
    }

    /**
     * Factory method for service container
     */
    static async create(config = {}) {
        // Return existing instance if available
        if (instance) {
            return instance;
        }

        const service = new ConnectionManager(config);
        await service.initialize();
        return service;
    }

    /**
     * Internal initialization
     */
    async _init() {
        // Clear any existing timers
        this.retryTimers.forEach(timer => clearTimeout(timer));
        this.retryTimers.clear();
        logger.info('Connection manager initialized');
    }

    async getConnection(dbName = 'default') {
        if (this.connections.has(dbName) && this.isConnectionHealthy(dbName)) {
            return this.connections.get(dbName);
        }

        return this.createConnection(dbName);
    }

    async createConnection(dbName = 'default') {
        if (!process.env.MONGODB_URI) {
            logger.error('MONGODB_URI not configured');
            return process.env.NODE_ENV === 'development' ? null : 
                Promise.reject(new Error('MONGODB_URI not configured'));
        }

        try {
            // Try Atlas connection
            const conn = await mongoose.createConnection(process.env.MONGODB_URI, {
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
                retryReads: true,
                serverApi: { version: '1', strict: true }
            }).asPromise().catch(error => {
                // Handle connection error
                if (process.env.NODE_ENV === 'development') {
                    logger.warn('Atlas connection failed:', error.message);
                    return null;
                }
                throw error;
            });

            // If Atlas connection failed in development, try local
            if (!conn && process.env.NODE_ENV === 'development') {
                try {
                    logger.info('Attempting local MongoDB connection');
                    const localConn = await mongoose.createConnection('mongodb://localhost:27017/lineleap_dev', {
                        serverSelectionTimeoutMS: 5000,
                        socketTimeoutMS: 45000,
                        connectTimeoutMS: 10000,
                        maxPoolSize: 10,
                        minPoolSize: 5,
                        retryWrites: true
                    }).asPromise();

                    if (localConn) {
                        this.connections.set(dbName, localConn);
                        this.clearRetryTimer(dbName);
                        logger.info('Local MongoDB connection established', { dbName });
                        return localConn;
                    }
                } catch (localError) {
                    logger.warn('Local MongoDB connection failed:', localError.message);
                    return null;
                }
            }

            // If we have a connection, store it
            if (conn) {
                this.connections.set(dbName, conn);
                this.clearRetryTimer(dbName);
                logger.info('MongoDB Atlas connection established', { dbName });
                return conn;
            }

            // Handle retry in production
            if (process.env.NODE_ENV !== 'development' && this.shouldRetry(dbName)) {
                const retryCount = this.getRetryCount(dbName);
                logger.info(`Scheduling retry ${retryCount + 1}/${this.config.maxRetries}`, { dbName });
                return this.scheduleRetry(dbName);
            }

            // Final state
            if (process.env.NODE_ENV === 'development') {
                logger.warn('Development mode: Continuing with degraded functionality');
                return null;
            }

            throw new Error('Failed to establish database connection');
        } catch (error) {
            logger.error('Connection error:', {
                dbName,
                error: error.message,
                retries: this.getRetryCount(dbName)
            });

            if (process.env.NODE_ENV === 'development') {
                return null;
            }
            throw error;
        }
    }

    clearRetryTimer(dbName) {
        const timer = this.retryTimers.get(dbName);
        if (timer) {
            clearTimeout(timer);
            this.retryTimers.delete(dbName);
        }
    }

    getRetryCount(dbName) {
        return this.retryTimers.has(dbName) ? 
            parseInt(this.retryTimers.get(dbName).toString().split('_')[1]) : 0;
    }

    shouldRetry(dbName) {
        return this.getRetryCount(dbName) < this.config.maxRetries;
    }

    scheduleRetry(dbName) {
        return new Promise(resolve => {
            const retryCount = this.getRetryCount(dbName);
            const delay = this.config.retryDelay * Math.pow(2, retryCount);

            this.clearRetryTimer(dbName);
            
            // Create a new timer that won't throw unhandled rejections
            const timer = setTimeout(() => {
                this.createConnection(dbName)
                    .then(resolve)
                    .catch(() => resolve(null));
            }, delay);

            this.retryTimers.set(dbName, timer);
            timer.toString = () => `timer_${retryCount + 1}`;
        });
    }

    isConnectionHealthy(dbName) {
        const conn = this.connections.get(dbName);
        return conn?.readyState === 1;
    }

    async _cleanup() {
        // Clear all retry timers
        this.retryTimers.forEach(timer => clearTimeout(timer));
        this.retryTimers.clear();

        // Close all connections
        for (const [dbName, conn] of this.connections.entries()) {
            try {
                await conn.close();
                logger.info('Closed MongoDB connection', { dbName });
            } catch (error) {
                logger.error('Error closing MongoDB connection:', {
                    dbName,
                    error: error.message
                });
            }
        }
        this.connections.clear();
    }

    getHealth() {
        return {
            connections: Array.from(this.connections.entries()).map(([name, conn]) => ({
                name,
                healthy: this.isConnectionHealthy(name),
                state: conn?.readyState || 0,
                retries: this.getRetryCount(name)
            }))
        };
    }
}

// Export singleton instance for backward compatibility
module.exports = new ConnectionManager();
// Also export the class for service container
module.exports.ConnectionManager = ConnectionManager; 