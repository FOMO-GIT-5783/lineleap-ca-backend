const path = require('path');
const dotenv = require('dotenv');

// Load appropriate .env file based on environment
const loadEnvFile = () => {
    try {
        const env = process.env.NODE_ENV || 'development';
        const envFile = `.env.${env}`;
        const rootDir = path.resolve(__dirname, '..');
        const envPath = path.join(rootDir, envFile);
        
        console.log(`Attempting to load environment from: ${envPath}`);
        const result = dotenv.config({ path: envPath });
        if (result.error) {
            throw new Error(`Error loading ${envFile}. Create a ${envFile} file with required variables.`);
        }
        console.log(`Environment loaded successfully. STRIPE_SECRET_KEY ${process.env.STRIPE_SECRET_KEY ? 'is present' : 'is missing'}`);
    } catch (error) {
        console.error('Environment configuration error:', error);
        throw error;
    }
};

// Load environment variables first
loadEnvFile();

// Initialize environment configuration
const config = {
    baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`,
    server: {
        primary: {
            port: parseInt(process.env.PORT || '3001', 10),
            host: process.env.HOST || '0.0.0.0',
            portRange: {
                min: parseInt(process.env.PORT_RANGE_MIN || '3001', 10),
                max: parseInt(process.env.PORT_RANGE_MAX || '3010', 10)
            }
        },
        secondary: {
            port: parseInt(process.env.ALTERNATE_PORT || '3011', 10),
            host: process.env.ALTERNATE_HOST || '0.0.0.0'
        }
    },
    corsOrigins: [
        'http://localhost:3000',
        'http://localhost:4200',
        'http://localhost:8100',
        'capacitor://localhost',
        'ionic://localhost'
    ].concat(
        // Add dynamic port range to CORS origins in development
        process.env.NODE_ENV === 'development' 
            ? Array.from(
                { length: 10 }, 
                (_, i) => `http://localhost:${3001 + i}`
              )
            : []
    ),
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
    database: {
        uri: process.env.MONGODB_URI,
        options: {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            autoIndex: process.env.NODE_ENV !== 'production', // Disable auto-indexing in production
            connectTimeoutMS: 10000,
            heartbeatFrequencyMS: 10000,
            minPoolSize: 5,
            maxIdleTimeMS: 30000,
            compressors: ['zlib']
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

// Validate port configuration
if (config.server.primary.portRange.min >= config.server.primary.portRange.max) {
    throw new Error('Invalid port range configuration: min must be less than max');
}

if (config.server.primary.port < config.server.primary.portRange.min || 
    config.server.primary.port > config.server.primary.portRange.max) {
    throw new Error(`Port ${config.server.primary.port} is outside the configured range (${config.server.primary.portRange.min}-${config.server.primary.portRange.max})`);
}

module.exports = { config }; 