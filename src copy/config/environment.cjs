const path = require('path');
const dotenv = require('dotenv');

// Environment validation
const validateEnv = () => {
    const required = {
        production: ['AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AUTH0_SECRET', 'MONGODB_URI', 'BASE_URL'],
        development: ['AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'MONGODB_URI'],
        test: ['MONGODB_URI']
    };

    const env = process.env.NODE_ENV || 'development';
    const missing = required[env]
        .filter(field => !process.env[field]);

    if (missing.length > 0) {
        throw new Error(`Missing required ENV vars for ${env}: ${missing.join(', ')}`);
    }
};

// Load appropriate .env file based on environment
const loadEnvFile = () => {
    try {
        const env = process.env.NODE_ENV || 'development';
        const envFile = `.env.${env}`;
        const rootDir = path.resolve(__dirname, '..', '..');
        const envPath = path.join(rootDir, envFile);
        
        const result = dotenv.config({ path: envPath });
        if (result.error) {
            const alternatePath = path.join(__dirname, '..', envFile);
            const alternateResult = dotenv.config({ path: alternatePath });
            if (alternateResult.error) {
                throw new Error(`Error loading ${envFile}. Create a ${envFile} file with required variables.`);
            }
        }

        // Validate environment after loading
        validateEnv();
    } catch (error) {
        console.error('Environment configuration error:', error);
        throw error;
    }
};

// Load environment variables first
loadEnvFile();

// Initialize environment with immediate validation
const config = (() => {
    const isProduction = process.env.NODE_ENV === 'production';
    const port = process.env.PORT || '3000';
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
    
    const rawConfig = {
        baseUrl,
        redis: {
            url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
            lockTTL: 10, // 10 seconds for payment locks
            retryCount: 3,
            keyPrefix: isProduction ? 'prod' : 'dev',
            options: {
                // Better defaults for development and production
                enableReadyCheck: true,
                maxRetriesPerRequest: 3,
                retryStrategy: (times) => {
                    if (times > 3) return null; // Stop retrying after 3 attempts
                    return Math.min(times * 1000, 3000); // Exponential backoff
                },
                reconnectOnError: (err) => {
                    const targetError = 'READONLY';
                    if (err.message.includes(targetError)) {
                        return true;
                    }
                    return false;
                },
                // Development specific settings
                host: process.env.NODE_ENV === 'development' ? '127.0.0.1' : undefined,
                port: process.env.NODE_ENV === 'development' ? 6379 : undefined,
                password: process.env.NODE_ENV === 'development' ? null : undefined,
                db: process.env.NODE_ENV === 'development' ? 0 : undefined,
                tls: process.env.NODE_ENV === 'production'
            },
            development: {
                enabled: true,
                fallback: 'memory',
                mockDelay: 50
            }
        },
        auth0: {
            clientID: process.env.AUTH0_CLIENT_ID,        // Keep uppercase for compatibility
            clientSecret: process.env.AUTH0_CLIENT_SECRET,
            issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,  // Keep uppercase for compatibility
            baseURL: baseUrl,  // Required by express-openid-connect
            secret: process.env.AUTH0_SECRET,
            audience: process.env.AUTH0_AUDIENCE,
            scope: process.env.AUTH0_SCOPE || 'openid profile email',
            responseType: process.env.AUTH0_RESPONSE_TYPE || 'code',
            responseMode: process.env.AUTH0_RESPONSE_MODE || 'query'
        },
        server: {
            primary: {
                port: parseInt(port, 10),
                host: process.env.HOST || '0.0.0.0'
            },
            secondary: {
                port: parseInt(process.env.ALTERNATE_PORT || '3001', 10),
                host: process.env.ALTERNATE_HOST || '0.0.0.0'
            }
        },
        corsOrigins: [
            baseUrl,
            ...(isProduction ? [] : ['capacitor://localhost', 'ionic://localhost'])
        ],
        jwt: {
            secret: process.env.JWT_SECRET || process.env.AUTH0_SECRET // Use AUTH0_SECRET as fallback
        }
    };

    // Immediate validation
    if (!rawConfig.auth0.clientID) throw new Error('AUTH0_CLIENT_ID required');
    if (!rawConfig.auth0.issuerBaseURL) throw new Error('AUTH0_ISSUER_BASE_URL required');
    if (!rawConfig.jwt.secret) throw new Error('JWT_SECRET or AUTH0_SECRET must be set in all environments for security');
    if (isProduction && !rawConfig.baseUrl) throw new Error('BASE_URL required in production');
    if (isProduction && !process.env.REDIS_URL) {
        throw new Error('REDIS_URL required in production for distributed locking');
    }

    return Object.freeze(rawConfig);
})();

module.exports = { config }; 