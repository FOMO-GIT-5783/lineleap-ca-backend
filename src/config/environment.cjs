const path = require('path');
const dotenv = require('dotenv');

// Load appropriate .env file based on environment
const loadEnvFile = () => {
    try {
        const env = process.env.NODE_ENV || 'development';
        const envFile = `.env.${env}`;
        const rootDir = path.resolve(__dirname, '..');
        const envPath = path.join(rootDir, envFile);
        
        const result = dotenv.config({ path: envPath });
        if (result.error) {
            throw new Error(`Error loading ${envFile}. Create a ${envFile} file with required variables.`);
        }
    } catch (error) {
        console.error('Environment configuration error:', error);
        throw error;
    }
};

// Load environment variables first
loadEnvFile();

// Initialize environment configuration
const config = {
    baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
    corsOrigins: [
        'http://localhost:3000',
        'http://localhost:4200',
        'http://localhost:8100',
        'capacitor://localhost',
        'ionic://localhost'
    ],
    jwt: {
        secret: process.env.JWT_SECRET || 'development-secret-key'
    },
    auth0: {
        clientID: process.env.AUTH0_CLIENT_ID,
        clientSecret: process.env.AUTH0_CLIENT_SECRET,
        issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
        secret: process.env.AUTH0_SECRET || 'development-auth0-secret',
        audience: process.env.AUTH0_AUDIENCE,
        baseURL: process.env.AUTH0_BASE_URL,
        responseType: process.env.AUTH0_RESPONSE_TYPE || 'code',
        responseMode: process.env.AUTH0_RESPONSE_MODE || 'query',
        scope: process.env.AUTH0_SCOPE || 'openid profile email'
    },
    server: {
        baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
        port: process.env.PORT || 3000,
        env: process.env.NODE_ENV || 'development'
    },
    database: {
        uri: process.env.MONGODB_URI,
        options: {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000
        }
    },
    stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
    },
    redis: {
        url: process.env.REDIS_URL,
        keyPrefix: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
        development: {
            mockDelay: process.env.NODE_ENV === 'development' ? 50 : 0
        }
    }
};

module.exports = { config }; 