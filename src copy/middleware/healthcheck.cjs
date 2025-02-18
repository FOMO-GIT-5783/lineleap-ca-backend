const mongoose = require('mongoose');
const { auth0 } = require('../config/auth');
const { redisClient } = require('../utils/cache');
const { getCircuitBreakers } = require('../utils/circuitBreaker');
const pkg = require('../package.json');

const checkMongoDB = async () => {
    try {
        const status = mongoose.connection.readyState;
        return {
            status: status === 1 ? 'healthy' : 'unhealthy',
            latency: await measureDBLatency()
        };
    } catch (error) {
        return { status: 'unhealthy', error: error.message };
    }
};

const checkAuth0 = async () => {
    try {
        await auth0.checkConnection();
        return { status: 'healthy' };
    } catch (error) {
        return { status: 'unhealthy', error: error.message };
    }
};

const checkRedis = async () => {
    try {
        await redisClient.ping();
        return { status: 'healthy' };
    } catch (error) {
        return { status: 'unhealthy', error: error.message };
    }
};

const measureDBLatency = async () => {
    const start = Date.now();
    await mongoose.connection.db.admin().ping();
    return Date.now() - start;
};

const healthCheck = async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date(),
        version: pkg.version
    };
    res.json(health);
};

const detailedHealthCheck = async (req, res) => {
    const [mongodb, auth, cache] = await Promise.all([
        checkMongoDB(),
        checkAuth0(),
        checkRedis()
    ]);

    const health = {
        status: mongodb.status === 'healthy' && 
                auth.status === 'healthy' && 
                cache.status === 'healthy' ? 'healthy' : 'degraded',
        timestamp: new Date(),
        version: pkg.version,
        components: {
            database: mongodb,
            auth,
            cache
        }
    };

    res.status(health.status === 'healthy' ? 200 : 503).json(health);
};

const circuitStatus = async (req, res) => {
    const breakers = getCircuitBreakers();
    res.json({ circuitBreakers: breakers });
};

module.exports = {
    healthCheck,
    detailedHealthCheck,
    circuitStatus
}; 