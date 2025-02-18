const logger = require('../utils/logger.cjs');
const AuthenticationService = require('../services/auth/AuthenticationService.cjs');
const { isPublicRoute } = require('./authMiddleware.cjs');

/**
 * Gradual migration middleware for authentication
 * Handles the transition between legacy and new authentication
 */
const gradualAuthMiddleware = () => {
    return async (req, res, next) => {
        try {
            // Skip auth for public routes
            if (isPublicRoute(req.path)) {
                logger.debug('Skipping auth for public route:', { path: req.path });
                return next();
            }

            // Get auth service instance
            const authService = AuthenticationService;
            if (!authService.isReady()) {
                logger.warn('Auth service not ready, using legacy auth');
                return require('./authMiddleware.cjs').requireAuth()(req, res, next);
            }

            // Let auth service handle the request
            return authService.authenticate(req, res, next);

        } catch (error) {
            logger.error('Auth middleware error:', {
                error: error.message,
                path: req.path,
                ip: req.ip
            });
            next(error);
        }
    };
};

module.exports = gradualAuthMiddleware; 