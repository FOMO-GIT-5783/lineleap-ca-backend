require('dotenv').config({ path: '.env.development' });
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { config } = require('../config/environment.cjs');

async function checkServices() {
    console.log('\nChecking external services...\n');
    let hasErrors = false;

    // 1. Check MongoDB
    try {
        console.log('🔄 Checking MongoDB connection...');
        const conn = await mongoose.connect(config.database.uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000
        });
        console.log('✅ MongoDB connected successfully!');
        console.log(`   Host: ${conn.connection.host}`);
        console.log(`   Database: ${conn.connection.name}`);
        console.log(`   State: ${conn.connection.readyState}`);
        await mongoose.connection.close();
    } catch (error) {
        console.log('❌ MongoDB connection failed:', error.message);
        if (error.message.includes('IP that isn\'t whitelisted')) {
            const publicIp = (await fetch('https://api.ipify.org').then(res => res.text())).trim();
            console.log(`\n⚠️  Your IP address ${publicIp} needs to be whitelisted in MongoDB Atlas:`);
            console.log('1. Go to MongoDB Atlas dashboard');
            console.log('2. Click on "Network Access"');
            console.log('3. Click "Add IP Address"');
            console.log(`4. Add your IP: ${publicIp}\n`);
        }
        hasErrors = true;
    }

    // 2. Check Stripe
    try {
        console.log('\n🔄 Checking Stripe connection...');
        const account = await stripe.accounts.retrieve();
        console.log('✅ Stripe connected successfully!');
        console.log(`   Account: ${account.id}`);
        console.log(`   API Version: ${stripe.getApiField('version')}`);
    } catch (error) {
        console.log('❌ Stripe connection failed:', error.message);
        hasErrors = true;
    }

    // 3. Check Environment Configuration
    try {
        console.log('\n🔄 Checking environment configuration...');
        const required = {
            'MongoDB URI': config.database.uri,
            'Stripe Secret Key': config.stripe.secretKey,
            'Auth0 Client ID': process.env.AUTH0_CLIENT_ID,
            'Auth0 Client Secret': process.env.AUTH0_CLIENT_SECRET,
            'Auth0 Issuer URL': process.env.AUTH0_ISSUER_BASE_URL,
            'Auth0 Audience': process.env.AUTH0_AUDIENCE
        };

        const missing = Object.entries(required)
            .filter(([_, value]) => !value)
            .map(([key]) => key);

        if (missing.length > 0) {
            throw new Error(`Missing required config: ${missing.join(', ')}`);
        }

        console.log('✅ Environment configuration valid!');
        console.log(`   Environment: ${process.env.NODE_ENV}`);
        console.log(`   Server Port: ${config.server.port}`);
        console.log(`   Base URL: ${config.server.baseUrl}`);
    } catch (error) {
        console.log('❌ Environment configuration check failed:', error.message);
        hasErrors = true;
    }

    // Summary
    console.log('\n📊 Service Check Summary:');
    if (hasErrors) {
        console.log('❌ Some services are not healthy. Please check the logs above.');
        process.exit(1);
    } else {
        console.log('✅ All services are healthy!');
        process.exit(0);
    }
}

// Run checks
checkServices().catch(error => {
    console.error('Service check failed:', error);
    process.exit(1);
}); 