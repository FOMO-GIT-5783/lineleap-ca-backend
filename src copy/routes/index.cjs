const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware.cjs');
const { validateRequest } = require('../middleware/validationMiddleware.cjs');
const { cors_whitelist } = require('../config/stripeConfig.cjs');
const logger = require('../utils/logger.cjs');
const cache = require('../middleware/cacheMiddleware.cjs');

// Import route handlers
const healthRouter = require('./healthRoutes.cjs');
const venueRoutes = require('./venueRoutes.cjs');
const orderRoutes = require('./orderRoutes.cjs');
const analyticsRoutes = require('./analyticsRoutes.cjs');
const dashboardRoutes = require('./dashboardRoutes.cjs');
const socialRoutes = require('./socialRoutes.cjs');
const adminRoutes = require('./adminRoutes.cjs');
const paymentRoutes = require('./paymentRoutes.cjs');
const venueManagementRoutes = require('./venueManagementRoutes.cjs');
const passRoutes = require('./passRoutes.cjs');

// API Documentation route
router.get('/docs', cache('1 hour'), (req, res) => {
    res.json({
        version: '1.0.0',
        description: 'LineLeap API Documentation',
        endpoints: {
            public: [
                { path: '/health', methods: ['GET'], description: 'Health check endpoint' },
                { path: '/venues', methods: ['GET'], description: 'Public venue information' }
            ],
            protected: [
                { path: '/orders', methods: ['GET', 'POST'], description: 'Order management' },
                { path: '/passes', methods: ['GET', 'POST'], description: 'Pass management' }
            ]
        }
    });
});

// Request validation schemas
const schemas = {
    venue: require('../schemas/venueSchema.cjs'),
    order: require('../schemas/orderSchema.cjs'),
    pass: require('../schemas/passSchema.cjs')
};

// Public Routes (no auth required)
// ==============================

// Health check routes
router.use('/health', healthRouter);

// Public venue routes (with caching)
router.use('/venues', cache('5 minutes'), venueRoutes);

// Public config routes
router.use('/config/stripe', cache('1 hour'), (req, res) => {
    res.json({ cors_whitelist });
});

// Protected Routes (require authentication)
// ======================================

// Venue Management (with validation)
router.use('/venue-management', 
    requireAuth(),
    validateRequest(schemas.venue),
    venueManagementRoutes
);

// Order Operations (with validation)
router.use('/orders',
    requireAuth(),
    validateRequest(schemas.order),
    orderRoutes
);

// Pass Operations (with validation)
router.use('/passes',
    requireAuth(),
    validateRequest(schemas.pass),
    passRoutes
);

// Payment Operations
router.use('/payments', requireAuth(), paymentRoutes);

// Analytics & Dashboard (with caching)
router.use('/analytics',
    requireAuth(),
    cache('1 minute'),
    analyticsRoutes
);

router.use('/dashboard',
    requireAuth(),
    cache('1 minute'),
    dashboardRoutes
);

// Social Features
router.use('/social', requireAuth(), socialRoutes);

// Admin Operations
router.use('/admin', requireAdmin(), adminRoutes);

// API Metrics
router.use((req, res, next) => {
    // Record API metrics
    const startTime = process.hrtime();
    
    res.on('finish', () => {
        const duration = process.hrtime(startTime);
        const durationMs = (duration[0] * 1e9 + duration[1]) / 1e6;
        
        logger.info('API Request', {
            path: req.path,
            method: req.method,
            status: res.statusCode,
            duration: durationMs,
            userAgent: req.get('user-agent')
        });
    });
    
    next();
});

// Error handling for routes
router.use((err, req, res, next) => {
    logger.error('Route Error:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        userId: req.user?._id
    });
    next(err);
});

module.exports = router; 