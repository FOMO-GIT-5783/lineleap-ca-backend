require('dotenv').config();

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
    maxNetworkRetries: 3,
    timeout: 10000
});

const cors_whitelist = [
    'http://localhost:3000',
    'https://lineleap-backend-2n48pwj21-cofrees-projects-90ff2bde.vercel.app',
    'https://staging-lineleap.vercel.app',
    'https://checkout.stripe.com',
    'https://api.stripe.com'
];

module.exports = {
    stripe,
    cors_whitelist
}; 