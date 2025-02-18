const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./routes/index.cjs');
const { errorHandler } = require('./middleware/errorMiddleware.cjs');
const { securityHeaders } = require('./middleware/securityMiddleware.cjs');
const { attachUser } = require('./middleware/authMiddleware.cjs');
const { auth } = require('express-openid-connect');
const logger = require('./utils/logger.cjs');

const app = express();

// Circuit breaker status
global.circuitBreakers = {
    stripe: { status: 'closed', failures: 0, lastCheck: Date.now() },
    database: { status: 'closed', failures: 0, lastCheck: Date.now() }
};

// Logging
app.use(morgan('dev'));

// Apply security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'js.stripe.com'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'api.stripe.com'],
            frameSrc: ["'self'", 'js.stripe.com'],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(securityHeaders);

// Enable CORS
app.use(cors({
    origin: (origin, callback) => {
        const allowedOrigins = [
            'capacitor://localhost',
            'ionic://localhost',
            'https://checkout.stripe.com',
            'https://dashboard.stripe.com',
            process.env.AUTH0_ISSUER_BASE_URL,
            process.env.BASE_URL,
            'http://localhost:3000',
            'http://localhost:4200'
        ].filter(Boolean);

        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400
}));

// Parse JSON bodies
app.use(express.json({
    verify: (req, res, buf) => {
        // Store raw body for webhook signature verification
        req.rawBody = buf;
    },
    limit: '10mb'
}));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configure Auth0
const auth0Config = {
    authRequired: false,
    auth0Logout: true,
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    clientID: process.env.AUTH0_CLIENT_ID,
    issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
    secret: process.env.AUTH0_SECRET || 'a-long-random-string-for-testing',
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    routes: {
        login: '/login',
        logout: '/logout',
        callback: '/callback'
    },
    authorizationParams: {
        response_type: 'code',
        scope: 'openid profile email'
    }
};

// Initialize Auth0
if (process.env.NODE_ENV === 'test') {
    // Skip Auth0 in test environment
    app.use((req, res, next) => {
        req.oidc = {
            isAuthenticated: () => true,
            user: { sub: 'test-user' }
        };
        next();
    });
} else {
    app.use(auth(auth0Config));
}

// Public routes (no auth required)
app.use('/api/health', require('./routes/healthRoutes.cjs'));
app.use('/api/venues', (req, res, next) => {
    if (req.method === 'GET' && ['/', '/search', '/featured'].includes(req.path)) {
        return next();
    }
    attachUser(req, res, next);
}, require('./routes/venueRoutes.cjs'));

// Protected routes
app.use('/api', attachUser);
app.use('/api', routes);

// Error handling
app.use(errorHandler);

// Handle 404s
app.use((req, res) => {
    logger.warn(`404 - Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
        status: 'error',
        error: {
            code: 'NOT_FOUND',
            message: 'Route not found'
        }
    });
});

// Export for testing
module.exports = { app, circuitBreakers: global.circuitBreakers }; 