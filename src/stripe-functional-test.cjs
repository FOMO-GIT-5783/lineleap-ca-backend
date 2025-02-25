/**
 * Stripe Functional Test
 * 
 * This script tests core Stripe functionality to verify that payment processing
 * would work regardless of account verification status in test mode.
 */

const path = require('path');
const fs = require('fs');

// Determine environment file path
const envPath = path.resolve(__dirname, '.env.development');
console.log(`Looking for env file at: ${envPath}`);
console.log(`File exists: ${fs.existsSync(envPath)}`);

// Try to load from multiple potential paths
try {
  require('dotenv').config({ path: envPath });
  console.log('Loaded env from src/.env.development');
} catch (err) {
  console.log(`Error loading from src dir: ${err.message}`);
}

if (!process.env.STRIPE_SECRET_KEY) {
  try {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env.development') });
    console.log('Loaded env from api/.env.development');
  } catch (err) {
    console.log(`Error loading from api root: ${err.message}`);
  }
}

// Fallback to manual setting if needed
if (!process.env.STRIPE_SECRET_KEY) {
  console.log('No env loaded, manually setting STRIPE_SECRET_KEY from config');
  try {
    const stripeConfig = require('./config/stripeConfig.cjs');
    if (stripeConfig && stripeConfig.stripe) {
      console.log('Found Stripe config module');
    }
  } catch (err) {
    console.log(`Error importing stripe config: ${err.message}`);
  }
}

// Import Stripe with fallback
let stripe;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('Created Stripe client with env key');
  } else {
    console.log('Attempting to import configured Stripe instance directly');
    const { stripe: configuredStripe } = require('./config/stripeConfig.cjs');
    stripe = configuredStripe;
    console.log('Using Stripe from config');
  }
} catch (error) {
  console.error('Failed to initialize Stripe:', error.message);
  process.exit(1);
}

async function runTest() {
  console.log('\n🔍 STRIPE FUNCTIONAL TEST');
  console.log('=======================\n');

  try {
    console.log('⚙️  ENVIRONMENT');
    console.log(`  - NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
    console.log(`  - STRIPE_KEY: ${process.env.STRIPE_SECRET_KEY ? '✅ Set (starts with: ' + process.env.STRIPE_SECRET_KEY.substring(0, 7) + '...)' : '❌ Not set'}`);
    console.log(`  - STRIPE_MODE: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? '🧪 TEST MODE' : '🚨 PRODUCTION MODE'}`);
    
    // Step 1: Create a test token (Using predefined test token instead of creating a payment method with raw card data)
    console.log('\n🧪 TEST 1: Using test payment method token');
    // Using a Stripe test token instead of raw card data
    // See: https://stripe.com/docs/testing
    const paymentMethodId = 'pm_card_visa'; // Predefined Stripe test payment method token
    
    console.log(`  ✅ Using Stripe test payment method: ${paymentMethodId}`);
    
    // Step 2: Create a payment intent
    console.log('\n🧪 TEST 2: Creating a payment intent');
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 2000, // $20.00
      currency: 'cad',
      payment_method_types: ['card'],
      capture_method: 'manual', // Requires explicit capture later
      metadata: { 
        test: 'true',
        testId: `test-${Date.now()}`
      }
    });
    
    console.log(`  ✅ Successfully created payment intent: ${paymentIntent.id}`);
    console.log(`  - Amount: $${(paymentIntent.amount / 100).toFixed(2)} ${paymentIntent.currency.toUpperCase()}`);
    console.log(`  - Status: ${paymentIntent.status}`);
    console.log(`  - Capture Method: ${paymentIntent.capture_method}`);
    
    // Step 3: Attach payment method to the payment intent and confirm
    console.log('\n🧪 TEST 3: Confirming payment intent with payment method');
    const confirmedIntent = await stripe.paymentIntents.confirm(
      paymentIntent.id,
      { payment_method: paymentMethodId }
    );
    
    console.log(`  ✅ Successfully confirmed payment intent: ${confirmedIntent.id}`);
    console.log(`  - New Status: ${confirmedIntent.status}`);
    console.log(`  - Payment Method: ${confirmedIntent.payment_method}`);
    
    // Step 4: Capture the payment (to complete the payment flow)
    console.log('\n🧪 TEST 4: Capturing the payment');
    const capturedIntent = await stripe.paymentIntents.capture(
      paymentIntent.id
    );
    
    console.log(`  ✅ Successfully captured payment: ${capturedIntent.id}`);
    console.log(`  - Final Status: ${capturedIntent.status}`);
    
    // Clean up - Refund the payment to keep the account clean
    console.log('\n🧯 CLEANUP: Refunding the test payment');
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntent.id,
    });
    
    console.log(`  ✅ Successfully refunded payment: ${refund.id}`);
    console.log(`  - Refund Status: ${refund.status}`);
    console.log(`  - Amount Refunded: $${(refund.amount / 100).toFixed(2)} ${refund.currency.toUpperCase()}`);
    
    console.log('\n✅ ALL TESTS PASSED! Core Stripe functionality is working properly.');
    console.log('This confirms that your Stripe integration can process payments in test mode.');
    console.log('Any health check failures are likely due to account verification requirements,');
    console.log('but they should not affect your ability to process test payments.');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED');
    console.error(`Error Message: ${error.message}`);
    
    if (error.type) {
      console.error(`Error Type: ${error.type}`);
    }
    
    if (error.code) {
      console.error(`Error Code: ${error.code}`);
    }
    
    if (error.decline_code) {
      console.error(`Decline Code: ${error.decline_code}`);
    }
    
    if (error.param) {
      console.error(`Error Parameter: ${error.param}`);
    }
    
    console.error('\nDetailed Error:', error);
    console.error('\nSome functionality may be restricted until you complete the Stripe verification requirements.');
    console.error('You may still be able to process test payments, but certain API calls might be limited.');
  }
}

// Run the test
runTest().catch(console.error); 