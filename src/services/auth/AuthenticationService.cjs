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
const { authEvents } = require('../../utils/authEvents.cjs');

// Maintain singleton for backward compatibility
let instance = null;

class AuthenticationService extends BaseService {
    constructor() {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('authentication-service');
        
        this.config = {
            provider: 'auth0',
            sessionDuration: 7200, // 2 hours
            refreshWindow: 300,    // 5 minutes
            maxLoginAttempts: 5,
            blockDuration: 900     // 15 minutes
        };

        instance = this;
    }

    async _init() {
        try {
            // In development mode, set as ready without full auth
            if (process.env.NODE_ENV === 'development') {
                this.ready = true;
                this.logger.info('Auth service initialized in development mode');
                return;
            }

            // Initialize Auth0 client
            await this.initializeAuth0Client();
            
            this.ready = true;
            this.logger.info('Auth service initialized successfully');
        } catch (error) {
            this.logger.error('Auth service initialization failed:', error);
            if (process.env.NODE_ENV === 'development') {
                this.ready = true;
                this.logger.warn('Continuing in development mode with degraded auth');
            } else {
                throw error;
            }
        }
    }

    async initializeAuth0Client() {
        // Initialize Auth0 client
        const auth0Config = this.getAuth0Config();
        this.auth0Client = auth(auth0Config);

        logger.info('Auth0 client initialized', {
            baseURL: auth0Config.baseURL,
            clientID: auth0Config.clientID,
            issuerBaseURL: auth0Config.issuerBaseURL,
            hasSecret: !!auth0Config.secret
        });
    }

    getAuth0Config() {
        // Required fields validation
        if (!config.auth0.clientID) {
            throw new Error('AUTH0_CLIENT_ID is required');
        }
        if (!config.auth0.issuerBaseURL) {
            throw new Error('AUTH0_ISSUER_BASE_URL is required');
        }
        if (!config.auth0.secret) {
            throw new Error('AUTH0_SECRET is required');
        }

        return {
            authRequired: false,
            auth0Logout: true,
            baseURL: config.auth0.baseURL || config.server.baseUrl,
            clientID: config.auth0.clientID,
            issuerBaseURL: config.auth0.issuerBaseURL,
            secret: config.auth0.secret,
            clientSecret: config.auth0.clientSecret,
            routes: {
                callback: '/api/auth/callback',
                login: '/api/auth/login'
            },
            session: {
                absoluteDuration: this.config.sessionDuration,
                rollingDuration: this.config.refreshWindow
            }
        };
    }

    async authenticate(req, res, next) {
        try {
            // Skip auth for public routes
            if (this.isPublicRoute(req.path)) {
                return next();
            }

            // Get and verify token
            const token = this.extractToken(req);
            if (!token) {
                throw createError.authentication(
                    ERROR_CODES.TOKEN_MISSING,
                    'Authentication token is required'
                );
            }

            // In development, allow any token
            if (process.env.NODE_ENV === 'development') {
                req.user = { _id: 'dev-user', roles: ['admin'] };
                return next();
            }

            // Verify token
            const decoded = await TokenService.verifyAuth0Token(token, {
                refreshToken: req.headers['x-refresh-token']
            });

            // Get or create user
            const user = await this.getOrCreateUser(decoded);
            if (!user) {
                throw createError.authentication(
                    ERROR_CODES.USER_NOT_FOUND,
                    'User not found'
                );
            }

            // Attach user to request
            req.user = user;

            // Check if token was refreshed
            if (res.locals.refreshedToken) {
                res.setHeader('X-New-Token', res.locals.refreshedToken);
            }

            next();
        } catch (error) {
            logger.error('Authentication failed:', {
                error: error.message,
                path: req.path
            });

            // Emit auth failure event
            authEvents.emitLoginFailed(this.getClientIP(req), error.message);

            next(error);
        }
    }

    async login(credentials) {
        try {
            // In development, return mock tokens
            if (process.env.NODE_ENV === 'development') {
                return {
                    user: { _id: 'dev-user', roles: ['admin'] },
                    tokens: {
                        access_token: 'dev-token',
                        refresh_token: 'dev-refresh-token',
                        expires_in: 3600
                    }
                };
            }

            // Validate credentials
            if (!credentials.email || !credentials.password) {
                throw createError.validation(
                    ERROR_CODES.INVALID_CREDENTIALS,
                    'Email and password are required'
                );
            }

            // Check rate limits
            const attempts = await this.getLoginAttempts(credentials.email);
            if (attempts >= this.config.maxLoginAttempts) {
                throw createError.rateLimit(
                    ERROR_CODES.MAX_LOGIN_ATTEMPTS,
                    'Too many login attempts'
                );
            }

            // Authenticate with Auth0
            const tokens = await this.auth0Client.getTokenSilently({
                ...credentials,
                scope: 'openid profile email'
            });

            // Get or create user
            const decoded = await TokenService.verifyAuth0Token(tokens.access_token);
            const user = await this.getOrCreateUser(decoded);

            // Reset login attempts
            await this.resetLoginAttempts(credentials.email);

            // Emit login success event
            authEvents.emitLoginSuccess(user._id);

            return {
                user,
                tokens: {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires_in: tokens.expires_in
                }
            };

        } catch (error) {
            // Increment failed attempts
            await this.incrementLoginAttempts(credentials.email);

            logger.error('Login failed:', {
                error: error.message,
                email: credentials.email
            });

            throw error;
        }
    }

    async handleCallback(req) {
        try {
            const tokens = await this.auth0Client.handleCallback(req);
            const decoded = await TokenService.verifyAuth0Token(tokens.access_token);
            const user = await this.getOrCreateUser(decoded);

            return {
                user,
                tokens
            };
        } catch (error) {
            logger.error('Auth callback failed:', error);
            throw error;
        }
    }

    async getOrCreateUser(decoded) {
        try {
            let user = await User.findOne({ auth0Id: decoded.sub });

            if (!user) {
                user = await User.create({
                    auth0Id: decoded.sub,
                    email: decoded.email,
                    name: decoded.name,
                    picture: decoded.picture
                });
            }

            return user;
        } catch (error) {
            logger.error('Failed to get/create user:', error);
            throw error;
        }
    }

    isPublicRoute(path) {
        return [
            '/api/health',
            '/api/auth/callback',
            '/api/auth/login',
            '/api/webhook'
        ].some(p => path.startsWith(p));
    }

    extractToken(req) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        return authHeader.split(' ')[1];
    }

    getClientIP(req) {
        return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
               req.socket.remoteAddress;
    }

    async getLoginAttempts(email) {
        const cache = this.getDependency('cache');
        return parseInt(await cache.get(`login_attempts:${email}`)) || 0;
    }

    async incrementLoginAttempts(email) {
        const cache = this.getDependency('cache');
        const attempts = await this.getLoginAttempts(email) + 1;
        await cache.set(`login_attempts:${email}`, attempts, this.config.blockDuration);
        return attempts;
    }

    async resetLoginAttempts(email) {
        const cache = this.getDependency('cache');
        await cache.delete(`login_attempts:${email}`);
    }

    async _cleanup() {
        this.auth0Client = null;
        logger.info('Authentication service cleaned up');
    }

    getHealth() {
        return {
            status: this.ready ? 'healthy' : 'unhealthy',
            provider: 'auth0',
            features: {
                auth0: this.auth0Client !== null,
                rateLimit: true,
                tokenRefresh: true
            },
            mode: process.env.NODE_ENV
        };
    }
}

// Export singleton instance for backward compatibility
module.exports = new AuthenticationService();
// Also export the class for service container
module.exports.AuthenticationService = AuthenticationService; 