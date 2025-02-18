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

router.post('/callback', async (req, res, next) => {
    try {
        const authService = AuthenticationService;
        if (!authService.isReady()) {
            throw new Error('Authentication service not ready');
        }

        const result = await authService.handleCallback(req.body);
        res.json(result);
    } catch (error) {
        authLogger.error('Callback handling failed:', error);
        next(error);
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

module.exports = router; 