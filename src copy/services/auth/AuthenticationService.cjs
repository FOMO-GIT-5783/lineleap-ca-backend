const BaseService = require('../../utils/baseService.cjs');
const logger = require('../../utils/logger.cjs');
const { createError, ERROR_CODES } = require('../../utils/errors.cjs');
const TokenService = require('../../utils/auth.cjs');
const SessionManager = require('../../utils/sessionManager.cjs');
const FeatureManager = require('../../services/payment/FeatureManager.cjs');
const { auth } = require('express-openid-connect');
const { config } = require('../../config/environment.cjs');
const jwt = require('jsonwebtoken');
const User = require('../../models/User.cjs');

// Maintain singleton for backward compatibility
let instance = null;

class AuthenticationService extends BaseService {
    constructor(config = {}) {
        if (instance) return instance;
        super('auth-service', {}, config);

        // Initialize metrics
        this.metrics = {
            legacy: {
                attempts: 0,
                success: 0,
                failed: 0
            },
            new: {
                attempts: 0,
                success: 0,
                failed: 0
            },
            latencies: [],
            errors: new Map(),
            lastAggregation: Date.now()
        };

        // Initialize state
        this.state = 'initializing';
        this.ready = false;

        // Initialize Auth0 config
        this.auth0Config = {
            authRequired: false,
            auth0Logout: true,
            baseURL: process.env.BASE_URL || 'http://localhost:3000',
            clientID: process.env.AUTH0_CLIENT_ID,
            issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
            secret: process.env.AUTH0_SECRET,
            clientSecret: process.env.AUTH0_CLIENT_SECRET,
            routes: {
                login: '/api/auth/login',
                callback: '/api/auth/callback'
            }
        };

        // Log Auth0 configuration
        logger.info('Auth0 client initialized', {
            baseURL: this.auth0Config.baseURL,
            clientID: this.auth0Config.clientID,
            issuerBaseURL: this.auth0Config.issuerBaseURL,
            hasSecret: !!this.auth0Config.secret
        });

        this.sessions = new Map();
        this.config = {
            tokenTTL: 3600,          // 1 hour
            refreshTokenTTL: 604800,  // 7 days
            maxSessions: 5,
            maxFailedAttempts: 5,
            blockDuration: 30 * 60 * 1000 // 30 minutes
        };
        this.logger = logger.child({
            context: 'auth',
            service: 'authentication'
        });

        instance = this;
    }

    /**
     * Factory method for service container
     */
    static async create(config = {}) {
        if (instance) return instance;
        const service = new AuthenticationService(config);
        await service.initialize();
        return service;
    }

    /**
     * Internal initialization
     */
    async _init() {
        try {
            const cache = this.getDependency('cache');
            const events = this.getDependency('events');
            const features = this.getDependency('features');

            if (!cache || !events || !features) {
                throw new Error('Required dependencies not available');
            }

            // Initialize dependencies
            this.tokenService = await this.initializeTokenService();
            this.sessionManager = await this.initializeSessionManager();
            this.featureManager = features;

            // Initialize feature flag
            await this.initializeFeatureFlag();

            // Start metrics aggregation
            this.startMetricsAggregation();

            // Start session cleanup job
            this.cleanupInterval = setInterval(() => {
                this.cleanupSessions();
            }, 5 * 60 * 1000); // Every 5 minutes

            // Set service as ready
            this.state = 'ready';
            this.ready = true;

            logger.info('Authentication service initialized', {
                features: await this.featureManager.getFeatureStates(),
                state: this.state
            });

            return true;
        } catch (error) {
            this.state = 'failed';
            this.ready = false;
            logger.error('Authentication service initialization failed:', error);
            throw error;
        }
    }

    async initializeTokenService() {
        const TokenService = require('../../utils/auth.cjs');
        await TokenService.initialize({
            dependencies: {
                cache: this.getDependency('cache'),
                events: this.getDependency('events')
            }
        });
        return TokenService;
    }

    async initializeSessionManager() {
        const SessionManager = require('../../utils/sessionManager.cjs');
        await SessionManager.initialize({
            dependencies: {
                cache: this.getDependency('cache'),
                events: this.getDependency('events')
            }
        });
        return SessionManager;
    }

    async initializeFeatureFlag() {
        const features = this.getDependency('features');
        if (!features) return;

        // Ensure USE_NEW_AUTH feature exists
        const feature = await features.getFeatureState('USE_NEW_AUTH');
        if (!feature) {
            await features.setFeatureState('USE_NEW_AUTH', {
                enabled: process.env.NODE_ENV === 'development',
                rolloutPercentage: process.env.NODE_ENV === 'development' ? 100 : 0,
                description: 'Use new authentication service',
                state: 'active',
                config: {
                    allowLegacyFallback: true,
                    enforceNewForV2: true,
                    venueOverrides: {}
                }
            });
        }
    }

    /**
     * Main authentication method
     */
    async authenticate(req, res, next) {
        if (!this.isReady()) {
            return next(createError.service(
                ERROR_CODES.SERVICE_NOT_READY,
                'Authentication service not ready'
            ));
        }

        try {
            const token = this.extractToken(req);
            if (!token) {
                throw createError.authentication(
                    ERROR_CODES.TOKEN_MISSING,
                    'Authentication token is required'
                );
            }

            const session = await this.validateSession(token);
            if (!session) {
                throw createError.authentication(
                    ERROR_CODES.SESSION_INVALID,
                    'Invalid or expired session'
                );
            }

            // Attach user and session to request
            req.user = session.user;
            req.session = session;

            // Update session activity
            await this.updateSessionActivity(session.id, {
                ip: req.ip,
                userAgent: req.get('user-agent'),
                path: req.path
            });

            next();
        } catch (error) {
            this.logger.error('Authentication failed:', {
                error: error.message,
                ip: req.ip,
                path: req.path
            });
            next(error);
        }
    }

    /**
     * Check if we should use new auth for this request
     */
    async shouldUseNewAuth(req) {
        try {
            // Check feature flag first
            const useNewAuth = await this.featureManager.isEnabled('USE_NEW_AUTH', {
                venueId: req.body?.venueId || req.query?.venueId,
                path: req.path
            });

            // Always use legacy auth for certain paths
            if (this.isLegacyPath(req.path)) {
                return false;
            }

            // Use new auth for all new API endpoints
            if (this.isNewApiPath(req.path)) {
                return true;
            }

            return useNewAuth;
        } catch (error) {
            logger.error('Error checking auth type:', error);
            return false; // Default to legacy auth on error
        }
    }

    /**
     * New authentication implementation
     */
    async authenticateNew(req) {
        const token = this.extractToken(req);
        if (!token) {
            throw createError.authentication(
                ERROR_CODES.TOKEN_MISSING,
                'Authentication token is required'
            );
        }

        // Verify token
        const decoded = await this.tokenService.verifyAuth0Token(token);
        if (!decoded) {
            throw createError.authentication(
                ERROR_CODES.TOKEN_INVALID,
                'Invalid authentication token'
            );
        }

        // Get or create session
        const session = this.sessionManager.getSession(decoded.sub, token);
        if (!session) {
            await this.sessionManager.handleSessionCreated({
                userId: decoded.sub,
                token,
                sessionData: {
                    deviceInfo: this.getDeviceInfo(req),
                    ip: req.ip
                }
            });
        }

        // Attach user to request
        req.user = decoded;
        req.session = session;
    }

    /**
     * Legacy authentication implementation
     */
    async authenticateLegacy(req) {
        // Delegate to existing auth middleware
        return new Promise((resolve, reject) => {
            legacyAuth(req, {}, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    /**
     * Helper methods
     */
    isLegacyPath(path) {
        return path.startsWith('/api/v1/') || 
               path.includes('/legacy/') ||
               path.startsWith('/webhook');
    }

    isNewApiPath(path) {
        return path.startsWith('/api/v2/') || 
               path.includes('/graphql');
    }

    extractToken(req) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        return authHeader.split(' ')[1];
    }

    getDeviceInfo(req) {
        return {
            userAgent: req.get('user-agent'),
            ip: req.ip,
            timestamp: new Date()
        };
    }

    /**
     * Metrics and monitoring
     */
    recordAttempt(isNew) {
        if (isNew) {
            this.metrics.new.attempts++;
        } else {
            this.metrics.legacy.attempts++;
        }
    }

    recordSuccess(isNew, duration) {
        if (isNew) {
            this.metrics.new.success++;
        } else {
            this.metrics.legacy.success++;
        }

        // Record latency
        this.metrics.latencies.push(duration);
        if (this.metrics.latencies.length > 1000) {
            this.metrics.latencies.shift();
        }
    }

    recordFailure(isNew, error) {
        if (isNew) {
            this.metrics.new.failed++;
        } else {
            this.metrics.legacy.failed++;
        }

        // Track error types
        const errorType = error.code || error.name || 'unknown';
        const currentCount = this.metrics.errors.get(errorType) || 0;
        this.metrics.errors.set(errorType, currentCount + 1);
    }

    startMetricsAggregation() {
        setInterval(() => {
            const avgLatency = this.metrics.latencies.length > 0
                ? this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length
                : 0;

            logger.info('Auth metrics aggregated', {
                legacy: {
                    ...this.metrics.legacy,
                    successRate: this.metrics.legacy.attempts > 0
                        ? (this.metrics.legacy.success / this.metrics.legacy.attempts) * 100
                        : 0
                },
                new: {
                    ...this.metrics.new,
                    successRate: this.metrics.new.attempts > 0
                        ? (this.metrics.new.success / this.metrics.new.attempts) * 100
                        : 0
                },
                avgLatency,
                errorCounts: Object.fromEntries(this.metrics.errors),
                timestamp: new Date().toISOString()
            });

            // Reset metrics for next period
            this.metrics.latencies = [];
            this.metrics.errors.clear();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    /**
     * Error handlers
     */
    handleTokenExpired(req, res, next) {
        res.status(401).json({
            error: {
                code: ERROR_CODES.TOKEN_EXPIRED,
                message: 'Token has expired',
                refreshUrl: '/api/auth/refresh'
            }
        });
    }

    handleRateLimit(req, res, next) {
        res.status(429).json({
            error: {
                code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
                message: 'Too many authentication attempts',
                retryAfter: 60
            }
        });
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
            service: 'auth-service',
            state: this.state,
            metrics: {
                legacy: {
                    ...this.metrics.legacy,
                    successRate: this.metrics.legacy.attempts > 0
                        ? (this.metrics.legacy.success / this.metrics.legacy.attempts) * 100
                        : 0
                },
                new: {
                    ...this.metrics.new,
                    successRate: this.metrics.new.attempts > 0
                        ? (this.metrics.new.success / this.metrics.new.attempts) * 100
                        : 0
                },
                performance: {
                    avgLatency,
                    errorCounts: Object.fromEntries(this.metrics.errors)
                }
            },
            dependencies: {
                tokenService: this.tokenService?.isReady() || false,
                sessionManager: this.sessionManager?.isReady() || false,
                featureManager: this.featureManager?.isReady() || false
            },
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Handle user login
     */
    async login(credentials) {
        if (!this.isReady()) {
            throw new Error('Authentication service not ready');
        }

        const startTime = Date.now();
        
        try {
            // Validate credentials
            if (!credentials.email || !credentials.password) {
                throw createError.validation(
                    ERROR_CODES.INVALID_CREDENTIALS,
                    'Email and password are required'
                );
            }

            // Log login attempt
            logger.info('Login attempt', {
                email: credentials.email,
                timestamp: new Date().toISOString()
            });

            // Create authorize URL
            const authorizeEndpoint = `${this.auth0Config.issuerBaseURL}/authorize`;
            const params = new URLSearchParams({
                response_type: 'code',
                client_id: this.auth0Config.clientID,
                redirect_uri: `${this.auth0Config.baseURL}/api/auth/callback`,
                scope: 'openid profile email',
                audience: process.env.AUTH0_AUDIENCE,
                state: Math.random().toString(36).substring(7)
            });

            // Return authorize URL
            return {
                authorizeUrl: `${authorizeEndpoint}?${params.toString()}`
            };

        } catch (error) {
            // Record failure
            this.recordFailure(true, error);

            // Log error
            logger.error('Login failed:', {
                error: error.message,
                code: error.code,
                email: credentials.email
            });

            throw error;
        }
    }

    /**
     * Handle Auth0 callback
     */
    async handleCallback(params) {
        if (!this.isReady()) {
            throw new Error('Authentication service not ready');
        }

        try {
            // Exchange code for tokens
            const tokenEndpoint = `${this.auth0Config.issuerBaseURL}/oauth/token`;
            const response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    grant_type: 'authorization_code',
                    client_id: this.auth0Config.clientID,
                    client_secret: this.auth0Config.clientSecret,
                    code: params.code,
                    redirect_uri: `${this.auth0Config.baseURL}/api/auth/callback`
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error_description || error.error || 'Token exchange failed');
            }

            const auth0Response = await response.json();

            // Get user info
            const userInfoEndpoint = `${this.auth0Config.issuerBaseURL}/userinfo`;
            const userInfoResponse = await fetch(userInfoEndpoint, {
                headers: {
                    'Authorization': `Bearer ${auth0Response.access_token}`
                }
            });

            if (!userInfoResponse.ok) {
                throw new Error('Failed to get user info');
            }

            const userProfile = await userInfoResponse.json();

            // Generate session token
            const token = await this.tokenService.generateToken({
                sub: userProfile.sub,
                email: userProfile.email
            });

            // Create session
            await this.sessionManager.handleSessionCreated({
                userId: userProfile.sub,
                token,
                sessionData: {
                    email: userProfile.email,
                    lastLogin: new Date()
                }
            });

            // Record success
            this.recordSuccess(true, Date.now() - startTime);

            // Log successful login
            logger.info('Login successful', {
                userId: userProfile.sub,
                email: userProfile.email
            });

            return {
                token,
                user: {
                    id: userProfile.sub,
                    email: userProfile.email,
                    name: userProfile.name
                }
            };

        } catch (error) {
            // Record failure
            this.recordFailure(true, error);

            // Log error
            logger.error('Callback handling failed:', {
                error: error.message,
                code: error.code
            });

            throw error;
        }
    }

    async validateSession(token) {
        try {
            const decoded = jwt.verify(token, config.jwt.secret);
            const session = this.sessions.get(decoded.sessionId);

            if (!session) {
                return null;
            }

            // Check session expiry
            if (Date.now() > session.expiresAt) {
                this.sessions.delete(decoded.sessionId);
                return null;
            }

            // Check if session was revoked
            if (session.revoked) {
                return null;
            }

            return session;
        } catch (error) {
            this.logger.error('Session validation failed:', error);
            return null;
        }
    }

    async createSession(user, context = {}) {
        try {
            // Check existing sessions
            const userSessions = Array.from(this.sessions.values())
                .filter(s => s.user._id.toString() === user._id.toString());

            // Enforce max sessions
            if (userSessions.length >= this.config.maxSessions) {
                // Remove oldest session
                const oldestSession = userSessions
                    .sort((a, b) => a.createdAt - b.createdAt)[0];
                this.sessions.delete(oldestSession.id);
            }

            const sessionId = this.generateSessionId();
            const session = {
                id: sessionId,
                user,
                createdAt: Date.now(),
                expiresAt: Date.now() + (this.config.tokenTTL * 1000),
                lastActivity: Date.now(),
                context: {
                    ip: context.ip,
                    userAgent: context.userAgent,
                    device: context.device
                },
                revoked: false
            };

            this.sessions.set(sessionId, session);

            // Generate tokens
            const accessToken = this.generateAccessToken(session);
            const refreshToken = this.generateRefreshToken(session);

            this.logger.info('Session created', {
                userId: user._id,
                sessionId,
                context
            });

            return {
                accessToken,
                refreshToken,
                expiresIn: this.config.tokenTTL
            };
        } catch (error) {
            this.logger.error('Session creation failed:', error);
            throw error;
        }
    }

    async updateSessionActivity(sessionId, activity) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.lastActivity = Date.now();
            session.context = {
                ...session.context,
                ...activity
            };
            this.sessions.set(sessionId, session);
        }
    }

    async revokeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.revoked = true;
            this.sessions.set(sessionId, session);
            
            this.logger.info('Session revoked', {
                sessionId,
                userId: session.user._id
            });
        }
    }

    async refreshToken(refreshToken) {
        try {
            const decoded = jwt.verify(refreshToken, config.jwt.secret);
            const session = this.sessions.get(decoded.sessionId);

            if (!session || session.revoked) {
                throw createError.authentication(
                    ERROR_CODES.REFRESH_TOKEN_INVALID,
                    'Invalid refresh token'
                );
            }

            // Generate new access token
            const accessToken = this.generateAccessToken(session);

            this.logger.info('Token refreshed', {
                sessionId: session.id,
                userId: session.user._id
            });

            return {
                accessToken,
                expiresIn: this.config.tokenTTL
            };
        } catch (error) {
            this.logger.error('Token refresh failed:', error);
            throw error;
        }
    }

    generateSessionId() {
        return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    generateAccessToken(session) {
        return jwt.sign({
            sub: session.user._id,
            sessionId: session.id,
            type: 'access'
        }, config.jwt.secret, {
            expiresIn: this.config.tokenTTL
        });
    }

    generateRefreshToken(session) {
        return jwt.sign({
            sub: session.user._id,
            sessionId: session.id,
            type: 'refresh'
        }, config.jwt.secret, {
            expiresIn: this.config.refreshTokenTTL
        });
    }

    cleanupSessions() {
        const now = Date.now();
        let cleaned = 0;

        for (const [sessionId, session] of this.sessions.entries()) {
            if (now > session.expiresAt || session.revoked) {
                this.sessions.delete(sessionId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.info('Sessions cleaned up', {
                cleaned,
                remaining: this.sessions.size
            });
        }
    }

    async _cleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.sessions.clear();
        this.logger.info('Authentication service cleaned up');
    }
}

// Export singleton instance for backward compatibility
module.exports = new AuthenticationService();
// Also export the class for service container
module.exports.AuthenticationService = AuthenticationService; 