const { auth } = require('express-openid-connect');
const { config } = require('../config/environment.cjs');
const logger = require('../utils/logger.cjs');
const User = require('../models/User.cjs');
const Pass = require('../models/Pass.cjs');
const tokenService = require('../utils/auth.cjs');
const { USER_ROLES } = require('../utils/constants.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const sessionManager = require('../utils/sessionManager.cjs');
const { authEvents } = require('../utils/authEvents.cjs');

// Create specialized logger
const authLogger = logger.child({
    context: 'auth',
    service: 'auth-middleware'
});

// Public paths that don't require authentication
const PUBLIC_PATHS = [
    '/api/health',
    '/api/monitoring',
    '/api/auth/callback',
    '/api/auth/login',
    '/api/auth/health',
    '/api/webhook'
];

// Helper to check if route is public
const isPublicRoute = (path) => {
    return PUBLIC_PATHS.some(p => path.startsWith(p) || path === p) && 
           !path.includes('/admin') && 
           !path.includes('/owner');
};

// Helper to get client IP
const getClientIP = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
           req.socket.remoteAddress;
};

// Single source of truth for Auth0 config
const getAuth0Config = (config) => {
    // Required fields validation with explicit error messages
    if (!config.auth0.clientID) {
        throw new Error('AUTH0_CLIENT_ID is required in all environments');
    }
    if (!config.auth0.issuerBaseURL) {
        throw new Error('AUTH0_ISSUER_BASE_URL is required in all environments');
    }
    if (!config.auth0.secret) {
        throw new Error('AUTH0_SECRET is required in all environments');
    }
    if (process.env.NODE_ENV === 'production' && !config.auth0.baseURL) {
        throw new Error('BASE_URL is required in production environment');
    }

    return {
        authRequired: false, // We'll handle this manually
        auth0Logout: true,
        clientID: config.auth0.clientID,
        clientSecret: config.auth0.clientSecret,
        issuerBaseURL: config.auth0.issuerBaseURL,
        baseURL: config.auth0.baseURL || config.server.baseUrl,
        secret: config.auth0.secret,
        routes: {
            login: '/api/auth/login',
            callback: '/api/auth/callback',
            postLogoutRedirect: '/'
        },
        session: {
            absoluteDuration: 7200,
            rollingDuration: 600,
            cookie: {
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'Lax',
                httpOnly: true
            }
        },
        authorizationParams: {
            response_type: 'code',
            response_mode: 'query',
            scope: 'openid profile email',
            audience: config.auth0.audience
        }
    };
};

// Middleware to require authentication
const requireAuth = (options = {}) => {
    return async (req, res, next) => {
        try {
            // Skip auth for public routes
            if (isPublicRoute(req.path)) {
                return next();
            }

            // Check rate limits
            const ip = getClientIP(req);
            if (!sessionManager.checkRateLimit(ip, 'auth')) {
                authEvents.emitRateLimitExceeded(ip, 'auth');
                throw createError.rateLimit(
                    ERROR_CODES.RATE_LIMIT_EXCEEDED,
                    'Too many authentication attempts'
                );
            }

            // Verify token
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                throw createError.authentication(
                    ERROR_CODES.TOKEN_MISSING,
                    'Authentication token is required'
                );
            }

            // Verify and potentially refresh token
            const decoded = await tokenService.verifyAuth0Token(token, {
                refreshToken: req.headers['x-refresh-token']
            });

            if (!decoded) {
                throw createError.authentication(
                    ERROR_CODES.TOKEN_INVALID,
                    'Invalid authentication token'
                );
            }

            // Check session validity
            const session = await sessionManager.getSession(decoded.sub);
            if (!session) {
                throw createError.authentication(
                    ERROR_CODES.SESSION_INVALID,
                    'Invalid or expired session'
                );
            }

            // Check session security
            if (!await sessionManager.validateSession(session, {
                ip,
                userAgent: req.get('user-agent')
            })) {
                throw createError.authentication(
                    ERROR_CODES.SESSION_SECURITY_ERROR,
                    'Session security validation failed'
                );
            }

            // Get or create user
            const user = await User.findOne({ auth0Id: decoded.sub });
            if (!user) {
                throw createError.authentication(
                    ERROR_CODES.USER_NOT_FOUND,
                    'User not found'
                );
            }

            // Check role requirements
            if (options.role && !user.hasRole(options.role)) {
                throw createError.authorization(
                    ERROR_CODES.INSUFFICIENT_ROLE,
                    'Insufficient permissions'
                );
            }

            // Update session activity
            await sessionManager.updateSessionActivity(session.id, {
                ip,
                userAgent: req.get('user-agent'),
                path: req.path
            });

            // Attach user and session to request
            req.user = user;
            req.session = session;

            // Check if token was refreshed
            if (res.locals.refreshedToken) {
                res.setHeader('X-New-Token', res.locals.refreshedToken);
            }

            next();

        } catch (error) {
            authLogger.error('Authentication failed:', {
                error: error.message,
                code: error.code,
                path: req.path
            });

            // Emit auth failure event
            authEvents.emitLoginFailed(getClientIP(req), error.message);

            next(error);
        }
    };
};

// Middleware to require customer role
const requireCustomer = (options = {}) => {
    return requireAuth({ ...options, role: USER_ROLES.CUSTOMER });
};

// Middleware to require admin role
const requireAdmin = (options = {}) => {
    return requireAuth({ ...options, role: USER_ROLES.ADMIN });
};

// Middleware to require venue owner role
const requireVenueOwner = (options = {}) => {
    return requireAuth({ ...options, role: USER_ROLES.VENUE_OWNER });
};

module.exports = {
    requireAuth,
    requireCustomer,
    requireAdmin,
    requireVenueOwner,
    isPublicRoute
};



