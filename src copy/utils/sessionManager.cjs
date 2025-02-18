const logger = require('./logger.cjs');
const BaseService = require('./baseService.cjs');
const { AUTH_EVENTS } = require('./authEvents.cjs');
const { createError, ERROR_CODES } = require('./errors.cjs');
const cacheService = require('../services/cacheService.cjs');

// Session configuration
const SESSION_CONFIG = {
    maxAge: 24 * 60 * 60 * 1000, // 24h
    cleanupInterval: 15 * 60 * 1000, // 15min
    rateLimit: {
        window: 15 * 60 * 1000, // 15min
        maxAttempts: 5
    },
    security: {
        maxSessionsPerUser: 5,
        maxFailedAttempts: 5,
        blockDuration: 30 * 60 * 1000 // 30min
    }
};

// Maintain singleton for backward compatibility
let instance = null;

class SessionManager extends BaseService {
    constructor(config = {}) {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('session-manager', {}, config);

        // Initialize instance variables
        this.sessions = null;
        this.blockedIPs = null;
        this.rateLimits = null;
        this.sessionAnalytics = null;

        // Initialize metrics
        this.metrics = {
            sessions: {
                created: 0,
                expired: 0,
                active: 0,
                avgDuration: 0
            },
            security: {
                blockedIPs: 0,
                failedLogins: 0,
                rateLimitHits: 0,
                suspiciousActivities: 0
            },
            latencies: [],
            errors: new Map(),
            lastAggregation: Date.now()
        };

        instance = this;
    }

    /**
     * Factory method for service container
     */
    static async create(config = {}) {
        // Return existing instance if available
        if (instance) {
            return instance;
        }

        const service = new SessionManager(config);
        await service.initialize();
        return service;
    }

    /**
     * Internal initialization
     */
    async _init() {
        const cache = this.getDependency('cache');
        const events = this.getDependency('events');

        // Initialize caches with specific TTLs
        this.sessions = cache.getCache('SESSION', { ttl: SESSION_CONFIG.maxAge });
        this.blockedIPs = cache.getCache('IP_BLOCK', { ttl: SESSION_CONFIG.security.blockDuration });
        this.rateLimits = cache.getCache('RATE_LIMIT', { ttl: SESSION_CONFIG.rateLimit.window });
        this.sessionAnalytics = cache.getCache('SESSION_ANALYTICS', { ttl: 24 * 60 * 60 * 1000 });

        // Set up event listeners with error handling
        const setupEventListener = (eventType, handler) => {
            events.safeOn(eventType, async (...args) => {
                try {
                    await handler.apply(this, args);
                } catch (error) {
                    this.handleError('event_handler', error, { eventType });
                }
            });
        };

        // Register event handlers
        setupEventListener(AUTH_EVENTS.SESSION_CREATED, this.handleSessionCreated);
        setupEventListener(AUTH_EVENTS.SESSION_UPDATED, this.handleSessionUpdated);
        setupEventListener(AUTH_EVENTS.SESSION_EXPIRED, this.handleSessionExpired);
        setupEventListener(AUTH_EVENTS.LOGIN_FAILED, this.handleLoginFailed);
        setupEventListener(AUTH_EVENTS.RATE_LIMIT_EXCEEDED, this.handleRateLimitExceeded);
        setupEventListener(AUTH_EVENTS.IP_BLOCKED, this.handleIPBlocked);

        // Start metrics aggregation
        this.startMetricsAggregation();

        // Start cleanup job
        this.startCleanupJob();

        logger.info('Session manager initialized', {
            config: SESSION_CONFIG,
            caches: ['SESSION', 'IP_BLOCK', 'RATE_LIMIT', 'SESSION_ANALYTICS']
        });
    }

    handleSessionCreated({ userId, token, sessionData, ip }) {
        if (!this.isReady()) {
            logger.warn('Session manager not ready, session creation delayed');
            return;
        }

        const startTime = Date.now();
        const sessionKey = `${userId}:${token}`;

        try {
            // Check for maximum sessions per user
            const userSessions = this.getUserSessions(userId);
            if (userSessions.length >= SESSION_CONFIG.security.maxSessionsPerUser) {
                // Expire oldest session
                const oldestSession = userSessions[0];
                this.handleSessionExpired({ userId, token: oldestSession.token });
            }

            // Create new session
            const session = {
                ...sessionData,
                userId,
                token,
                ip,
                createdAt: new Date(),
                lastAccess: new Date(),
                accessCount: 0,
                deviceInfo: sessionData.deviceInfo || {}
            };

            this.sessions.set(sessionKey, session);

            // Update metrics
            this.metrics.sessions.created++;
            this.metrics.sessions.active = this.sessions.size;
            this.recordMetric('session_created', {
                userId,
                ip,
                duration: Date.now() - startTime
            });

            // Record analytics
            this.updateSessionAnalytics(userId, 'created', session);

            logger.info('Session created:', { userId, ip });
        } catch (error) {
            this.handleError('session_creation', error, { userId, ip });
            throw error;
        }
    }

    handleSessionUpdated({ userId, token, sessionData }) {
        if (!this.isReady()) return;

        const startTime = Date.now();
        const sessionKey = `${userId}:${token}`;

        try {
            const existingSession = this.sessions.get(sessionKey);
            if (existingSession) {
                const updatedSession = {
                    ...existingSession,
                    ...sessionData,
                    lastAccess: new Date(),
                    accessCount: (existingSession.accessCount || 0) + 1
                };

                this.sessions.set(sessionKey, updatedSession);

                // Record analytics
                this.updateSessionAnalytics(userId, 'updated', updatedSession);

                this.recordMetric('session_updated', {
                    userId,
                    duration: Date.now() - startTime,
                    accessCount: updatedSession.accessCount
                });
            }
        } catch (error) {
            this.handleError('session_update', error, { userId });
        }
    }

    handleSessionExpired({ userId, token, reason = 'expired' }) {
        if (!this.isReady()) return;

        const sessionKey = `${userId}:${token}`;
        const session = this.sessions.get(sessionKey);

        if (session) {
            // Update metrics
            this.metrics.sessions.expired++;
            this.metrics.sessions.active = this.sessions.size - 1;

            const duration = Date.now() - session.createdAt;
            this.metrics.sessions.avgDuration = 
                (this.metrics.sessions.avgDuration * this.metrics.sessions.expired + duration) / 
                (this.metrics.sessions.expired + 1);

            // Record analytics
            this.updateSessionAnalytics(userId, 'expired', { ...session, reason });

            // Delete session
            this.sessions.delete(sessionKey);

            logger.info('Session expired:', { userId, reason, duration });
        }
    }

    handleLoginFailed({ ip, userId, reason }) {
        if (!this.isReady()) return;

        try {
            // Update metrics
            this.metrics.security.failedLogins++;

            const attempts = this.rateLimits.get(ip) || 0;
            this.rateLimits.set(ip, attempts + 1);

            if (attempts >= SESSION_CONFIG.security.maxFailedAttempts) {
                this.handleSecurityAlert({
                    type: 'excessive_failed_logins',
                    ip,
                    userId,
                    attempts: attempts + 1
                });
            }

            logger.warn('Login failed:', { ip, userId, reason, attempts: attempts + 1 });
        } catch (error) {
            this.handleError('login_failed', error, { ip, userId });
        }
    }

    handleSecurityAlert({ type, ip, userId, details }) {
        if (!this.isReady()) return;

        try {
            // Block IP
            this.blockedIPs.set(ip, {
                reason: type,
                timestamp: Date.now(),
                details
            });

            // Update metrics
            this.metrics.security.blockedIPs = this.blockedIPs.size;

            // Emit security event
            const events = this.getDependency('events');
            events.emitAuthEvent('SECURITY_ALERT', {
                type,
                ip,
                userId,
                details,
                timestamp: new Date()
            });

            logger.warn('Security alert:', { type, ip, userId, details });
        } catch (error) {
            this.handleError('security_alert', error, { type, ip, userId });
        }
    }

    handleSuspiciousActivity({ type, ip, userId, details }) {
        if (!this.isReady()) return;

        try {
            // Update metrics
            this.metrics.security.suspiciousActivities++;

            // Record analytics
            this.updateSessionAnalytics(userId, 'suspicious_activity', {
                type,
                ip,
                details,
                timestamp: new Date()
            });

            logger.warn('Suspicious activity detected:', { type, ip, userId, details });
        } catch (error) {
            this.handleError('suspicious_activity', error, { type, ip, userId });
        }
    }

    // Public methods
    isIPBlocked(ip) {
        if (!this.isReady()) {
            logger.warn('Session manager not ready, IP check defaulting to false');
            return false;
        }

        const blockInfo = this.blockedIPs.get(ip);
        if (blockInfo) {
            const blockAge = Date.now() - blockInfo.timestamp;
            return blockAge < SESSION_CONFIG.security.blockDuration;
        }
        return false;
    }

    getSession(userId, token) {
        if (!this.isReady()) {
            logger.warn('Session manager not ready, session retrieval failed');
            return null;
        }

        const session = this.sessions.get(`${userId}:${token}`);
        if (session) {
            // Update last access
            this.handleSessionUpdated({ userId, token, sessionData: {} });
        }
        return session;
    }

    getUserSessions(userId) {
        if (!this.isReady()) return [];

        return Array.from(this.sessions.entries())
            .filter(([key]) => key.startsWith(`${userId}:`))
            .map(([_, session]) => session)
            .sort((a, b) => a.createdAt - b.createdAt);
    }

    checkRateLimit(ip, type, path = null) {
        if (!this.isReady()) {
            logger.warn('Session manager not ready, rate limit check defaulting to true');
            return true;
        }

        // Skip rate limiting for health endpoints
        if (path && (path === '/health' || path.startsWith('/api/health'))) {
            return true;
        }

        try {
            const key = `${type}:${ip}`;
            const attempts = this.rateLimits.get(key) || 0;
            
            if (attempts >= SESSION_CONFIG.rateLimit.maxAttempts) {
                this.metrics.security.rateLimitHits++;
                
                const events = this.getDependency('events');
                events.emitAuthEvent('RATE_LIMIT_HIT', { 
                    ip, 
                    type,
                    attempts,
                    timestamp: new Date()
                });
                
                return false;
            }
            
            this.rateLimits.set(key, attempts + 1);
            return true;
        } catch (error) {
            this.handleError('rate_limit_check', error, { ip, type });
            return false;
        }
    }

    updateSessionAnalytics(userId, action, data) {
        try {
            const key = `analytics:${userId}`;
            const analytics = this.sessionAnalytics.get(key) || {
                userId,
                sessions: [],
                activities: []
            };

            if (action === 'created' || action === 'expired') {
                analytics.sessions.push({
                    action,
                    timestamp: new Date(),
                    ...data
                });
                // Keep only last 10 sessions
                if (analytics.sessions.length > 10) {
                    analytics.sessions.shift();
                }
            } else {
                analytics.activities.push({
                    action,
                    timestamp: new Date(),
                    ...data
                });
                // Keep only last 50 activities
                if (analytics.activities.length > 50) {
                    analytics.activities.shift();
                }
            }

            this.sessionAnalytics.set(key, analytics);
        } catch (error) {
            this.handleError('analytics_update', error, { userId, action });
        }
    }

    recordMetric(type, data) {
        const events = this.getDependency('events');
        
        // Record latency
        if (data.duration) {
            this.metrics.latencies.push(data.duration);
            if (this.metrics.latencies.length > 1000) {
                this.metrics.latencies.shift();
            }
        }

        // Emit metric event
        events?.emitAuthEvent('METRICS_UPDATED', {
            type,
            ...data,
            timestamp: new Date()
        });
    }

    handleError(operation, error, context = {}) {
        // Update error metrics
        const errorType = error.code || error.name || 'unknown';
        const currentCount = this.metrics.errors.get(errorType) || 0;
        this.metrics.errors.set(errorType, currentCount + 1);

        // Log error with context
        logger.error(`Session operation failed: ${operation}`, {
            error: error.message,
            code: error.code,
            context,
            stack: error.stack
        });
    }

    startMetricsAggregation() {
        setInterval(() => {
            const avgLatency = this.metrics.latencies.length > 0
                ? this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length
                : 0;

            logger.info('Session metrics aggregated', {
                sessions: this.metrics.sessions,
                security: this.metrics.security,
                avgLatency,
                errorCounts: Object.fromEntries(this.metrics.errors),
                timestamp: new Date().toISOString()
            });

            // Reset metrics for next period
            this.metrics.latencies = [];
            this.metrics.errors.clear();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    startCleanupJob() {
        setInterval(async () => {
            await this._cleanup();
        }, SESSION_CONFIG.cleanupInterval);
    }

    /**
     * Cleanup expired sessions and rate limits
     */
    async _cleanup() {
        if (!this.isReady()) return;

        const startTime = Date.now();
        let cleaned = 0;

        try {
            // Cleanup expired sessions
            for (const [key, session] of this.sessions.entries()) {
                const age = Date.now() - session.lastAccess;
                if (age > SESSION_CONFIG.maxAge) {
                    this.handleSessionExpired({ 
                        userId: session.userId, 
                        token: session.token,
                        reason: 'cleanup'
                    });
                    cleaned++;
                }
            }

            // Cleanup rate limits
            for (const [key, attempts] of this.rateLimits.entries()) {
                if (attempts < SESSION_CONFIG.rateLimit.maxAttempts) {
                    this.rateLimits.delete(key);
                    cleaned++;
                }
            }

            // Cleanup blocked IPs
            for (const [ip, blockInfo] of this.blockedIPs.entries()) {
                const blockAge = Date.now() - blockInfo.timestamp;
                if (blockAge > SESSION_CONFIG.security.blockDuration) {
                    this.blockedIPs.delete(ip);
                    cleaned++;
                }
            }

            logger.info('Session cleanup completed', {
                duration: Date.now() - startTime,
                cleaned,
                remaining: {
                    sessions: this.sessions.size,
                    rateLimits: this.rateLimits.size,
                    blockedIPs: this.blockedIPs.size
                }
            });
        } catch (error) {
            this.handleError('cleanup', error);
        }
    }

    /**
     * Check if service is ready
     */
    isReady() {
        return this.state === 'ready' && 
               this.sessions !== null && 
               this.blockedIPs !== null && 
               this.rateLimits !== null &&
               this.sessionAnalytics !== null;
    }

    /**
     * Get service health
     */
    getHealth() {
        const avgLatency = this.metrics.latencies.length > 0
            ? this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length
            : 0;

        return {
            status: this.isReady() ? 'healthy' : 'unhealthy',
            service: 'session-manager',
            metrics: {
                sessions: {
                    ...this.metrics.sessions,
                    current: this.sessions?.size || 0
                },
                security: {
                    ...this.metrics.security,
                    currentlyBlocked: this.blockedIPs?.size || 0,
                    currentlyRateLimited: this.rateLimits?.size || 0
                },
                performance: {
                    avgLatency,
                    errorCounts: Object.fromEntries(this.metrics.errors)
                }
            },
            config: SESSION_CONFIG,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    }
}

// Export singleton instance for backward compatibility
module.exports = new SessionManager();
// Also export the class for service container
module.exports.SessionManager = SessionManager; 