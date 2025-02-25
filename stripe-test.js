// Manual test script for Stripe connection
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
const envFile = '.env.development';
const envPath = path.join(__dirname, 'src', envFile);
console.log(`Loading environment from: ${envPath}`);
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error(`Error loading environment: ${result.error.message}`);
  process.exit(1);
}

console.log(`STRIPE_SECRET_KEY loaded: ${process.env.STRIPE_SECRET_KEY ? 'Yes (starts with ' + process.env.STRIPE_SECRET_KEY.substring(0, 7) + ')' : 'No'}`);

// Initialize Stripe
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  maxNetworkRetries: 3,
  timeout: 15000,
  telemetry: false
});

// Test connection
console.log('Testing Stripe connection...');
stripe.paymentMethods.list({ limit: 1 })
  .then(result => {
    console.log('Stripe connection successful!');
    console.log(`Result: ${JSON.stringify(result.data.length)} payment methods found`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Stripe connection failed:');
    console.error(`Message: ${error.message}`);
    console.error(`Type: ${error.type}`);
    console.error(`Code: ${error.code}`);
    console.error(`Stack: ${error.stack}`);
    process.exit(1);
  }); 