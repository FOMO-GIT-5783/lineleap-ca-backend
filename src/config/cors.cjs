const { config } = require('./environment.cjs');

// Environment-specific origins
const getEnvironmentOrigins = () => {
    const env = process.env.NODE_ENV || 'development';
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    
    // Production origins
    if (env === 'production') {
        return [
            baseUrl,
            'https://app.lineleap.com',          // Main frontend app
            'https://admin.lineleap.com',        // Admin dashboard
            'https://api.lineleap.com',          // API domain
            'https://dashboard.lineleap.com',     // Venue dashboard
            process.env.AUTH0_ISSUER_BASE_URL     // Auth0 domain
        ].filter(Boolean);
    }
    
    // Development/staging origins
    return [
        baseUrl,
        'http://localhost:3000',     // React dev server
        'http://localhost:4200',     // Angular dev server
        'http://localhost:8100',     // Ionic dev server
        'capacitor://localhost',     // Capacitor local
        'ionic://localhost',         // Ionic local
        process.env.AUTH0_ISSUER_BASE_URL
    ].filter(Boolean);
};

// Payment service origins
const PAYMENT_ORIGINS = [
    'https://checkout.stripe.com',
    'https://dashboard.stripe.com',
    'https://api.stripe.com'
];

// WebSocket origins
const WEBSOCKET_ORIGINS = [
    'ws://localhost:3000',
    'wss://api.lineleap.com'
];

// Combine all origins
const getAllowedOrigins = () => {
    return [
        ...getEnvironmentOrigins(),
        ...PAYMENT_ORIGINS,
        ...WEBSOCKET_ORIGINS
    ];
};

// CORS Configuration
const corsConfig = {
    // Origin configuration
    origin: (origin, callback) => {
        const allowedOrigins = getAllowedOrigins();
        
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },

    // Request methods
    methods: [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS'
    ],

    // Allowed headers
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'X-CSRF-Token',
        'X-Auth-Token',
        'X-Refresh-Token',
        'X-Client-Version',
        'X-Device-Id'
    ],

    // Exposed headers
    exposedHeaders: [
        'X-New-Token',
        'X-Rate-Limit-Remaining',
        'X-Rate-Limit-Reset'
    ],

    // Credentials support
    credentials: true,

    // Pre-flight cache duration (24 hours)
    maxAge: 86400,

    // Success status for pre-flight
    optionsSuccessStatus: 204
};

// WebSocket specific CORS config
const wsConfig = {
    cors: {
        origin: corsConfig.origin,
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: corsConfig.allowedHeaders
    },
    pingTimeout: 60000,
    pingInterval: 25000
};

// Validation helper
const validateOrigin = (origin) => {
    const allowedOrigins = getAllowedOrigins();
    return !origin || allowedOrigins.includes(origin);
};

module.exports = {
    corsConfig,
    wsConfig,
    validateOrigin,
    getAllowedOrigins
}; 