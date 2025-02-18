const rateLimit = require('express-rate-limit');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const { getVenueLimits, isPeakHour } = require('../config/rateLimits.cjs');
const WebSocketMonitor = require('../utils/websocketMonitor.cjs');
const redisClient = require('../utils/redisClient.cjs');
const logger = require('../utils/logger.cjs');

// Store for tracking venue-specific rate limits
const venueWindows = new Map();

// Helper to get venue ID from request
const getVenueId = (req) => {
    return req.params.venueId || req.body.venueId || req.query.venueId;
};

// Create venue-specific rate limiter
const createVenueLimiter = (venueId, type) => {
    const limits = getVenueLimits(venueId);
    const limit = limits[type];

    return rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: limit,
        handler: async (req, res) => {
            const error = createError.rateLimit(
                ERROR_CODES.RATE_LIMIT_EXCEEDED,
                `Rate limit exceeded for ${type}`
            );

            // Record rate limit breach
            await WebSocketMonitor.recordMetric('rate_limit_exceeded', {
                venueId,
                type,
                limit,
                isPeakHour: isPeakHour()
            });

            logger.warn('Rate limit exceeded:', {
                venueId,
                type,
                limit,
                ip: req.ip
            });

            res.status(429).json(error);
        },
        keyGenerator: (req) => `${venueId}:${req.ip}:${type}`,
        // Use our Redis client with LRU fallback
        store: {
            async incr(key) {
                const count = await redisClient.get(key);
                const newCount = (parseInt(count) || 0) + 1;
                await redisClient.set(key, newCount.toString(), 900); // 15 minutes
                return newCount;
            },
            async decr(key) {
                const count = await redisClient.get(key);
                const newCount = Math.max(0, (parseInt(count) || 0) - 1);
                await redisClient.set(key, newCount.toString(), 900);
                return newCount;
            },
            async resetKey(key) {
                await redisClient.set(key, "0", 900);
            }
        },
        skip: async (req) => {
            // Check venue metrics for potential limit adjustments
            try {
                const metrics = await WebSocketMonitor.getVenueMetrics(venueId);
                if (metrics.state === 'warning' || metrics.state === 'critical') {
                    // Log potential issues
                    logger.warn('High load detected during rate limit check:', {
                        venueId,
                        metrics
                    });
                }
                return false;
            } catch (error) {
                logger.error('Error checking venue metrics:', error);
                return false;
            }
        }
    });
};

// Middleware factory for different rate limit types
const createRateLimiter = (type) => {
    return async (req, res, next) => {
        const venueId = getVenueId(req);
        
        if (!venueId) {
            return next(createError.validation(
                ERROR_CODES.MISSING_VENUE_ID,
                'Venue ID is required for rate limiting'
            ));
        }

        const windowKey = `${venueId}:${type}`;
        
        if (!venueWindows.has(windowKey)) {
            venueWindows.set(windowKey, createVenueLimiter(venueId, type));
        }

        const limiter = venueWindows.get(windowKey);
        return limiter(req, res, next);
    };
};

// Export specific limiters
module.exports = {
    orderLimiter: createRateLimiter('orderCreation'),
    passLimiter: createRateLimiter('passValidation'),
    wsConnectionLimiter: createRateLimiter('websocketConnections')
}; 