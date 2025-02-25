const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Rate limiting configuration
const createRateLimiter = (windowMs = 15 * 60 * 1000, max = 100) => rateLimit({
    windowMs,
    max,
    message: {
        status: 429,
        error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user ? req.user._id : req.ip // Use user ID if authenticated
});

// Different rate limits for different endpoints
const authLimiter = createRateLimiter(60 * 1000, 300);     // 300 requests per minute for auth operations
const loginLimiter = createRateLimiter(60 * 1000, 50);     // 50 login attempts per minute per IP
const apiLimiter = createRateLimiter(60 * 1000, 500);      // 500 requests per minute for general API

// Pass purchase rate limit - 30 per minute per user
const passPurchaseLimiter = createRateLimiter(60 * 1000, 30);

// Real-time updates rate limit - 100 per minute
const realtimeUpdatesLimiter = createRateLimiter(60 * 1000, 100);

// Event release queue system
const eventReleaseLimiter = createRateLimiter(60 * 1000, 1000); // Higher limit during event releases

// Security headers configuration
const securityHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'js.stripe.com'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'api.stripe.com', 'dev-vcxivfkv8x4robxr.us.auth0.com'],
            frameSrc: ["'self'", 'js.stripe.com'],
            objectSrc: ["'none'"],
            scriptSrcAttr: ["'unsafe-inline'"],  // Allow inline event handlers
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
});

// Halifax-specific verification rate limit
// 10 verifications per minute per venue
const verificationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 verifications/minute/venue
    keyGenerator: req => req.params.venueId,
    message: {
        error: 'Too many verifications - venue staff should verify manually'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Add comments explaining the rationale
/* Rate Limit Rationale:
 * - Vercel automatically handles request distribution across serverless functions
 * - MongoDB Atlas has built-in connection pooling and DDoS protection
 * - Auth endpoints (300/min): Allows for high-traffic periods and multiple concurrent users
 * - Login attempts (50/min): Still protected but allows for venue scenarios with multiple staff
 * - General API (500/min): Generous limit for real-time updates and concurrent users
 * - Pass purchase (30/min): Higher limit for busy venues processing multiple orders
 * - Real-time updates (100/min): Higher limit for real-time updates
 * - Event release (1000/min): Higher limit during event releases
 */

module.exports = {
    authLimiter,      // For general auth endpoints (token refresh, verify, etc.)
    loginLimiter,     // Specifically for login attempts
    apiLimiter,
    passPurchaseLimiter,
    realtimeUpdatesLimiter,
    eventReleaseLimiter,
    securityHeaders,
    verificationLimiter
}; 