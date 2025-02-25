const path = require('path');
const dotenv = require('dotenv');

// Use the same environment loading approach as in environment.cjs
const env = process.env.NODE_ENV || 'development';
const envFile = `.env.${env}`;
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, envFile);

// Only load environment if not already loaded
if (!process.env.STRIPE_SECRET_KEY) {
    console.log(`[stripeConfig] Loading environment from ${envPath}`);
    const result = dotenv.config({ path: envPath });
    if (result.error) {
        console.error(`[stripeConfig] Error loading environment: ${result.error.message}`);
    } else {
        console.log(`[stripeConfig] Environment loaded successfully. STRIPE_SECRET_KEY is ${process.env.STRIPE_SECRET_KEY ? 'present' : 'missing'}`);
    }
}

const Stripe = require('stripe');
const logger = require('../utils/logger.cjs');

try {
    // Validate API key presence
    if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error('STRIPE_SECRET_KEY is missing from environment variables');
    }
    
    console.log(`[stripeConfig] Initializing Stripe with key starting with ${process.env.STRIPE_SECRET_KEY.substring(0, 7)}...`);
    // Add additional diagnostic information
    console.log(`[stripeConfig] NODE_ENV: ${process.env.NODE_ENV}`);
    
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2023-10-16', // Keep existing version for now
        maxNetworkRetries: 3,
        timeout: 15000, // Increased timeout for better reliability
        telemetry: false // Disable telemetry for faster connections
    });

    // Test connection immediately to catch issues early
    // This will be executed asynchronously after module export
    setTimeout(() => {
        stripe.paymentMethods.list({ limit: 1 })
            .then(() => {
                console.log(`[stripeConfig] Initial connection test successful`);
            })
            .catch(connErr => {
                console.error(`[stripeConfig] Initial connection test failed:`, {
                    message: connErr.message,
                    type: connErr.type,
                    code: connErr.code,
                    statusCode: connErr.statusCode
                });
            });
    }, 1000);

    const cors_whitelist = [
        'http://localhost:3000',
        'https://lineleap-backend-2n48pwj21-cofrees-projects-90ff2bde.vercel.app',
        'https://staging-lineleap.vercel.app',
        'https://checkout.stripe.com',
        'https://api.stripe.com'
    ];

    console.log(`[stripeConfig] Stripe initialized successfully`);
    module.exports = {
        stripe,
        cors_whitelist
    };
} catch (error) {
    // Enhanced error logging
    console.error(`[stripeConfig] Stripe configuration error:`, {
        message: error.message,
        name: error.name,
        stack: error.stack,
        type: error.type,
        code: error.code,
        statusCode: error.statusCode,
        NODE_ENV: process.env.NODE_ENV,
        hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
        keyPrefix: process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.substring(0, 7) : 'none'
    });
    
    logger.error('Stripe configuration error:', error);
    // Provide a fallback to prevent the application from crashing
    const dummyStripe = {
        paymentIntents: { create: async () => {}, list: async () => ({ data: [] }) },
        paymentMethods: { list: async () => ({ data: [] }) },
        webhooks: { constructEvent: () => {} }
    };
    
    module.exports = {
        stripe: dummyStripe,
        cors_whitelist: []
    };
} 