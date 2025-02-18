const express = require('express');
const logger = require('../utils/logger.cjs');
const { requireAuth } = require('../middleware/authMiddleware.cjs');

// Route registry for better organization and clarity
const routeRegistry = {
    public: [
        { path: '/health', module: '../routes/healthRoutes.cjs' },
        { path: '/auth', module: '../routes/authRoutes.cjs' },
        { path: '/webhook', module: '../routes/webhookRoutes.cjs' }
    ],
    protected: [
        { path: '/payments', module: '../routes/paymentRoutes.cjs' },
        { path: '/orders', module: '../routes/orderRoutes.cjs' },
        { path: '/monitoring', module: '../routes/monitoringRoutes.cjs' },
        { path: '/venues', module: '../routes/venueRoutes.cjs' },
        { path: '/passes', module: '../routes/passRoutes.cjs' },
        { path: '/users', module: '../routes/userRoutes.cjs' },
        { path: '/metrics', module: '../routes/metricsRoutes.cjs' }
    ]
};

// Route configuration function
const configureRoutes = (app) => {
    logger.info('Starting route configuration');
    
    // Public routes first
    routeRegistry.public.forEach(route => {
        try {
            logger.info(`Loading route module: ${route.module}`);
            const routeModule = require(route.module);
            app.use(`/api${route.path}`, routeModule);
            logger.info(`Successfully registered route: ${route.path}`);
        } catch (error) {
            logger.error(`Failed to load route module: ${route.module}`, error);
        }
    });

    // Protected routes
    routeRegistry.protected.forEach(route => {
        try {
            logger.info(`Loading protected route module: ${route.module}`);
            const routeModule = require(route.module);
            app.use(`/api${route.path}`, requireAuth(), routeModule);
            logger.info(`Successfully registered protected route: ${route.path}`);
        } catch (error) {
            logger.error(`Failed to load protected route module: ${route.module}`, error);
        }
    });

    logger.info('Route configuration completed');
};

module.exports = {
    configureRoutes,
    routeRegistry
}; 