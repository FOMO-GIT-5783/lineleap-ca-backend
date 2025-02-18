const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redisClient = require('../utils/redisClient.cjs');
const logger = require('../utils/logger.cjs');
const cacheService = require('../services/cacheService.cjs');

// Halifax-specific rate limits
const HALIFAX_LIMITS = {
    global: {
        windowMs: 60 * 1000, // 1 minute
        max: 1000,           // requests per window
        burst: 1500         // max burst
    },
    venue: {
        windowMs: 60 * 1000,
        max: 200,           // per venue
        burst: 300
    },
    user: {
        windowMs: 60 * 1000,
        max: 50,            // per user
        burst: 75
    },
    payment: {
        windowMs: 60 * 1000,
        max: 10,            // payment attempts
        burst: 15
    },
    auth: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 30,                  // attempts per window
        burst: 45,
        blockDuration: 30 * 60 * 1000 // 30 minutes block
    },
    suspicious: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 5,                   // attempts before long block
        blockDuration: 24 * 60 * 60 * 1000 // 24 hours block
    }
};

class RateLimiter {
    constructor() {
        this.redisStore = new RedisStore({
            client: redisClient.getClient(),
            prefix: 'rl:halifax:',
            windowMs: 60000
        });
        
        this.statsCache = cacheService.getCache('RATE_LIMIT');
        this.suspiciousIPs = new Set();
        this.initializeMetrics();
    }

    initializeMetrics() {
        setInterval(() => {
            this.recordMetrics();
        }, 60000);
    }

    async recordMetrics() {
        const metrics = await this.redisStore.client.hGetAll('rl:halifax:metrics');
        this.statsCache.set('rate_limit_metrics', metrics);
        
        // Alert on high usage
        Object.entries(metrics).forEach(([key, value]) => {
            const [type, id] = key.split(':');
            const limit = HALIFAX_LIMITS[type]?.max || HALIFAX_LIMITS.global.max;
            const usage = parseInt(value);
            
            if (usage > limit * 0.8) {
                logger.warn('High rate limit usage:', {
                    type,
                    id,
                    usage,
                    limit,
                    percentage: (usage / limit * 100).toFixed(2)
                });
            }
        });
    }

    async isSuspiciousIP(ip) {
        const key = `suspicious:${ip}`;
        const attempts = await this.redisStore.client.get(key) || 0;
        return attempts >= HALIFAX_LIMITS.suspicious.max;
    }

    async trackSuspiciousIP(ip) {
        const key = `suspicious:${ip}`;
        const attempts = await this.redisStore.client.incr(key);
        
        if (attempts >= HALIFAX_LIMITS.suspicious.max) {
            this.suspiciousIPs.add(ip);
            // Set block duration
            await this.redisStore.client.expire(
                key,
                HALIFAX_LIMITS.suspicious.blockDuration / 1000
            );
            
            logger.warn('IP marked as suspicious:', {
                ip,
                attempts,
                blockDuration: HALIFAX_LIMITS.suspicious.blockDuration
            });
        }
    }

    getGlobalLimiter() {
        return rateLimit({
            store: this.redisStore,
            windowMs: HALIFAX_LIMITS.global.windowMs,
            max: (req) => {
                // Dynamic limit based on current load
                const baseLimit = HALIFAX_LIMITS.global.max;
                const metrics = this.statsCache.get('rate_limit_metrics') || {};
                const currentLoad = Object.values(metrics)
                    .reduce((sum, val) => sum + parseInt(val || 0), 0);
                
                // Allow burst during low usage
                if (currentLoad < baseLimit * 0.5) {
                    return HALIFAX_LIMITS.global.burst;
                }
                return baseLimit;
            },
            keyGenerator: (req) => {
                // Use IP + User Agent for better bot detection
                return `${req.ip}:${req.get('user-agent')}`;
            },
            handler: (req, res) => {
                logger.warn('Global rate limit exceeded:', {
                    ip: req.ip,
                    path: req.path,
                    userAgent: req.get('user-agent')
                });
                res.status(429).json({
                    error: 'Too many requests, please try again later',
                    retryAfter: res.getHeader('Retry-After')
                });
            }
        });
    }

    getVenueLimiter() {
        return rateLimit({
            store: this.redisStore,
            windowMs: HALIFAX_LIMITS.venue.windowMs,
            max: HALIFAX_LIMITS.venue.max,
            keyGenerator: (req) => {
                return `venue:${req.params.venueId || req.body.venueId}`;
            },
            skip: (req) => {
                // Skip for health checks and static assets
                return req.path.startsWith('/health') || 
                       req.path.startsWith('/static');
            }
        });
    }

    getUserLimiter() {
        return rateLimit({
            store: this.redisStore,
            windowMs: HALIFAX_LIMITS.user.windowMs,
            max: HALIFAX_LIMITS.user.max,
            keyGenerator: (req) => {
                return `user:${req.user?.id || req.ip}`;
            }
        });
    }

    getPaymentLimiter() {
        return rateLimit({
            store: this.redisStore,
            windowMs: HALIFAX_LIMITS.payment.windowMs,
            max: (req) => {
                const baseLimit = HALIFAX_LIMITS.payment.max;
                
                // Stricter limits for payment confirmation
                if (req.path.includes('/confirm-payment')) {
                    return Math.floor(baseLimit * 0.5); // 50% of base limit
                }

                // Check for repeated failed attempts
                const key = `payment:${req.user?.id || req.ip}`;
                const failedAttempts = this.statsCache.get(`${key}:failed`) || 0;
                
                // Reduce limit based on failed attempts
                if (failedAttempts > 3) {
                    return Math.floor(baseLimit * 0.3); // 30% of base limit
                }
                
                return baseLimit;
            },
            keyGenerator: (req) => {
                // Include payment intent ID in the key if available
                const paymentIntentId = req.body?.paymentIntentId;
                return `payment:${req.user?.id || req.ip}:${paymentIntentId || ''}`;
            },
            handler: async (req, res) => {
                const key = `payment:${req.user?.id || req.ip}`;
                
                // Increment failed attempts counter
                const failedAttempts = (this.statsCache.get(`${key}:failed`) || 0) + 1;
                this.statsCache.set(`${key}:failed`, failedAttempts, 3600); // 1 hour TTL
                
                logger.warn('Payment rate limit exceeded:', {
                    userId: req.user?.id,
                    ip: req.ip,
                    failedAttempts,
                    amount: req.body?.amount
                });

                // Notify monitoring system
                const events = this.getDependency('events');
                events?.emitPaymentEvent('RATE_LIMIT_EXCEEDED', {
                    userId: req.user?.id,
                    ip: req.ip,
                    failedAttempts
                });

                res.status(429).json({
                    error: 'Too many payment attempts, please try again later',
                    retryAfter: res.getHeader('Retry-After'),
                    remainingAttempts: 0
                });
            },
            skip: (req) => {
                // Skip for webhook endpoints
                return req.path.includes('/webhook');
            }
        });
    }

    getAuthLimiter() {
        return rateLimit({
            store: this.redisStore,
            windowMs: HALIFAX_LIMITS.auth.windowMs,
            max: async (req) => {
                // Check for suspicious IP
                if (await this.isSuspiciousIP(req.ip)) {
                    return 0; // Block all requests
                }
                
                const baseLimit = HALIFAX_LIMITS.auth.max;
                const metrics = this.statsCache.get('rate_limit_metrics') || {};
                const failedAttempts = parseInt(metrics[`auth:${req.ip}`] || 0);
                
                // Reduce limit based on failed attempts
                if (failedAttempts > 5) {
                    return Math.floor(baseLimit * 0.5); // 50% of base limit
                }
                
                return baseLimit;
            },
            handler: async (req, res) => {
                await this.trackSuspiciousIP(req.ip);
                
                logger.warn('Auth rate limit exceeded:', {
                    ip: req.ip,
                    path: req.path,
                    userAgent: req.get('user-agent')
                });

                // Emit auth failure event
                const events = this.getDependency('events');
                events?.emitAuthEvent('RATE_LIMIT_EXCEEDED', {
                    ip: req.ip,
                    path: req.path
                });

                res.status(429).json({
                    error: 'Too many authentication attempts',
                    retryAfter: res.getHeader('Retry-After')
                });
            },
            keyGenerator: (req) => `auth:${req.ip}`,
            skip: (req) => req.path.startsWith('/health')
        });
    }

    getHealth() {
        return {
            status: 'healthy',
            suspiciousIPs: this.suspiciousIPs.size,
            metrics: this.statsCache.get('rate_limit_metrics') || {}
        };
    }
}

module.exports = new RateLimiter();