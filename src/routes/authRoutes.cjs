const express = require('express');
const router = express.Router();
const AuthenticationService = require('../services/auth/AuthenticationService.cjs');
const logger = require('../utils/logger.cjs');
const { isPublicRoute } = require('../middleware/authMiddleware.cjs');

// Create specialized logger
const authLogger = logger.child({
    context: 'auth',
    service: 'auth-routes'
});

// Public routes first (no auth required)
router.post('/login', async (req, res, next) => {
    try {
        const authService = AuthenticationService;
        if (!authService.isReady()) {
            throw new Error('Authentication service not ready');
        }

        const result = await authService.login(req.body);
        res.json(result);
    } catch (error) {
        authLogger.error('Login failed:', error);
        next(error);
    }
});

// Auth test page (public)
router.get('/test', (req, res) => {
    res.sendFile('auth-test.html', { root: './src/public' });
});

router.get('/callback', async (req, res, next) => {
    try {
        // Check if Auth0 returned an error
        if (req.query.error) {
            authLogger.error('Auth0 returned an error:', {
                error: req.query.error,
                description: req.query.error_description
            });
            
            // Return a user-friendly error response
            return res.status(401).json({
                status: 'error',
                error: {
                    code: 'auth0/login-failed',
                    message: req.query.error_description || 'Authentication failed',
                    details: {
                        error: req.query.error
                    }
                }
            });
        }
        
        const authService = AuthenticationService;
        if (!authService.isReady()) {
            throw new Error('Authentication service not ready');
        }

        const result = await authService.handleCallback(req.query);
        
        // Return success with user info but not sensitive token data
        res.json({
            status: 'success',
            data: {
                user: result.user,
                isNewUser: result.user.isNewUser || false,
                authenticated: true
            }
        });
    } catch (error) {
        authLogger.error('Callback handling failed:', error);
        
        // Return a structured error response
        res.status(401).json({
            status: 'error',
            error: {
                code: error.code || 'auth/callback-failed',
                message: error.message || 'Authentication failed',
                category: error.category || 'auth',
                severity: error.severity || 'error',
                action: error.action || 'reauth',
                retryable: error.retryable || false,
                details: error.details || {},
                timestamp: new Date().toISOString(),
                dev: {
                    stack: error.stack,
                    context: error.context || {}
                }
            }
        });
    }
});

// Health check endpoint (public)
router.get('/health', async (req, res) => {
    try {
        const authService = AuthenticationService;
        if (!authService.isReady()) {
            throw new Error('Authentication service not ready');
        }

        const health = await authService.getHealth();
        res.json(health);
    } catch (error) {
        authLogger.error('Health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Add auth middleware for protected routes
router.use((req, res, next) => {
    if (isPublicRoute(req.path)) {
        return next();
    }
    return AuthenticationService.authenticate(req, res, next);
});

// Status endpoint (protected)
router.get('/status', async (req, res, next) => {
    try {
        const authService = AuthenticationService;
        if (!authService.isReady()) {
            throw new Error('Authentication service not ready');
        }

        res.json({
            status: 'authenticated',
            user: req.user,
            mode: process.env.NODE_ENV
        });
    } catch (error) {
        authLogger.error('Status check failed:', error);
        next(error);
    }
});

module.exports = router; 