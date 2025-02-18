const logger = require('../utils/logger.cjs');

// Simple in-memory cache
const cache = new Map();

// Parse duration string to milliseconds
const parseDuration = (duration) => {
    const units = {
        second: 1000,
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000
    };

    const [value, unit] = duration.split(' ');
    return parseInt(value) * units[unit.replace(/s$/, '')];
};

// Cache middleware factory
const cacheMiddleware = (duration) => {
    const durationMs = parseDuration(duration);

    return (req, res, next) => {
        // Skip cache for non-GET requests
        if (req.method !== 'GET') {
            return next();
        }

        // Generate cache key from URL and auth status
        const key = `${req.originalUrl}-${req.user?._id || 'public'}`;

        // Check cache
        const cachedResponse = cache.get(key);
        if (cachedResponse && cachedResponse.expiry > Date.now()) {
            logger.debug('Cache hit:', { key, url: req.originalUrl });
            return res.json(cachedResponse.data);
        }

        // Store original json method
        const originalJson = res.json;

        // Override json method to cache response
        res.json = function(data) {
            // Store in cache
            cache.set(key, {
                data,
                expiry: Date.now() + durationMs
            });

            logger.debug('Cache set:', { key, url: req.originalUrl, expiry: durationMs });

            // Call original json method
            return originalJson.call(this, data);
        };

        next();
    };
};

// Cache cleanup
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (value.expiry <= now) {
            cache.delete(key);
            logger.debug('Cache cleanup:', { key });
        }
    }
}, 60000); // Clean up every minute

module.exports = cacheMiddleware; 