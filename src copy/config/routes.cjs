const express = require('express');
const { requireAuth, requireCustomer } = require('../middleware/authMiddleware.cjs');

// Route registry for better organization and clarity
const routeRegistry = {
    public: [
        { path: '/health', module: '../routes/healthRoutes.cjs' },
        { path: '/monitoring', module: '../routes/monitoringRoutes.cjs' },
        { path: '/webhook', module: '../routes/webhookRoutes.cjs' },
        { path: '/auth', module: '../routes/authRoutes.cjs' }
    ],
    protected: [
        { 
            path: '/payments', 
            module: '../routes/paymentRoutes.cjs', 
            middleware: [requireCustomer()]
        },
        { 
            path: '/orders', 
            module: '../routes/orderRoutes.cjs', 
            middleware: [requireCustomer()]
        }
    ]
};

// Route configuration function
const configureRoutes = (app) => {
    // Public routes first
    routeRegistry.public.forEach(route => {
        try {
            const routeModule = require(route.module);
            const router = routeModule.router || routeModule;
            app.use(`/api${route.path}`, router);
            console.info(`Registered public route: ${route.path}`);
        } catch (error) {
            console.warn(`Failed to load route module: ${route.module}`, error);
        }
    });

    // Protected API routes
    routeRegistry.protected.forEach(route => {
        try {
            const routeModule = require(route.module);
            const router = routeModule.router || routeModule;
            const middleware = route.middleware || [];
            app.use(`/api${route.path}`, ...middleware, router);
            console.info(`Registered protected route: ${route.path}`);
        } catch (error) {
            console.warn(`Failed to load route module: ${route.module}`, error);
        }
    });
};

module.exports = {
    configureRoutes,
    routeRegistry
}; 