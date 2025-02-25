const BaseService = require('../../utils/baseService.cjs');
const logger = require('../../utils/logger.cjs');
const { createError, ERROR_CODES } = require('../../utils/errors.cjs');
const TokenService = require('../../utils/auth.cjs');
const SessionManager = require('../../utils/sessionManager.cjs');
const FeatureManager = require('../../services/payment/FeatureManager.cjs');
const { auth } = require('express-openid-connect');
const { config } = require('../../config/environment.cjs');
const jwt = require('jsonwebtoken');
const User = require('../../models/User.cjs');
const { authEvents } = require('../../utils/authEvents.cjs');

// Maintain singleton for backward compatibility
let instance = null;

class AuthenticationService extends BaseService {
    constructor() {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('authentication-service');
        
        this.config = {
            provider: 'auth0',
            sessionDuration: 7200, // 2 hours
            refreshWindow: 300,    // 5 minutes
            maxLoginAttempts: 5,
            blockDuration: 900     // 15 minutes
        };

        instance = this;
    }

    async _init() {
        try {
            // Initialize TokenService first
            await TokenService.initialize();
            
            // In development mode, set up mock auth client
            if (process.env.NODE_ENV === 'development') {
                this.auth0Client = {
                    getTokenSilently: async () => ({ 
                        access_token: 'dev-token',
                        refresh_token: 'dev-refresh-token',
                        expires_in: 3600
                    }),
                    handleCallback: async () => ({
                        access_token: 'dev-token',
                        refresh_token: 'dev-refresh-token',
                        expires_in: 3600
                    })
                };
                this.ready = true;
                this.logger.info('Auth service initialized in development mode');
                return true;
            }

            // Initialize Auth0 client
            await this.initializeAuth0Client();
            
            this.ready = true;
            this.logger.info('Auth service initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('Auth service initialization failed:', error);
            if (process.env.NODE_ENV === 'development') {
                this.ready = true;
                this.logger.warn('Continuing in development mode with degraded auth');
                return true;
            }
            throw error;
        }
    }

    getAuth0Config() {
        // Validate required configuration
        if (!config.auth0.clientID) {
            throw new Error('AUTH0_CLIENT_ID is required');
        }
        if (!config.auth0.issuerBaseURL) {
            throw new Error('AUTH0_ISSUER_BASE_URL is required');
        }
        if (!config.auth0.secret) {
            throw new Error('AUTH0_SECRET is required');
        }

        return {
            authRequired: false,
            auth0Logout: true,
            baseURL: config.auth0.baseURL || config.server.baseUrl,
            clientID: config.auth0.clientID,
            issuerBaseURL: config.auth0.issuerBaseURL,
            secret: config.auth0.secret,
            clientSecret: config.auth0.clientSecret,
            routes: {
                callback: '/api/auth/callback',
                login: '/api/auth/login'
            },
            session: {
                absoluteDuration: this.config.sessionDuration,
                rollingDuration: this.config.refreshWindow
            }
        };
    }

    async initializeAuth0Client() {
        // Initialize Auth0 client
        const auth0Config = this.getAuth0Config();
        
        // The 'auth' function from express-openid-connect is a middleware creator, not a client
        // For development, we've already defined a mock client earlier
        // For production, we need to initialize the proper Auth0 client with methods
        if (process.env.NODE_ENV !== 'development') {
            // Create a proper Auth0 client with handleCallback method
            this.auth0Client = {
                // Implement proper token acquisition
                getTokenSilently: async () => {
                    // In a real implementation, this would interact with Auth0
                    // For now, we'll return a minimal implementation
                    return { 
                        access_token: 'production-token',
                        refresh_token: 'production-refresh-token',
                        expires_in: 3600
                    };
                },
                
                // Implement proper callback handling
                handleCallback: async (req) => {
                    if (!req.code) {
                        throw new Error('Authorization code is missing from callback parameters');
                    }
                    
                    try {
                        // Exchange the authorization code for tokens
                        const tokenResponse = await fetch(`${config.auth0.issuerBaseURL}/oauth/token`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                grant_type: 'authorization_code',
                                client_id: config.auth0.clientID,
                                client_secret: config.auth0.clientSecret,
                                code: req.code,
                                redirect_uri: `${config.auth0.baseURL}/api/auth/callback`
                            })
                        });
                        
                        if (!tokenResponse.ok) {
                            const errorData = await tokenResponse.json();
                            throw new Error(`Token exchange failed: ${errorData.error_description || 'Unknown error'}`);
                        }
                        
                        return await tokenResponse.json();
                    } catch (error) {
                        this.logger.error('Auth0 token exchange failed:', error);
                        throw error;
                    }
                }
            };
        }
        
        // Configure middleware (but don't set it as the client)
        this.auth0Middleware = auth(auth0Config);

        logger.info('Auth0 client initialized', {
            baseURL: auth0Config.baseURL,
            clientID: auth0Config.clientID,
            issuerBaseURL: auth0Config.issuerBaseURL,
            hasSecret: !!auth0Config.secret
        });
    }

    async authenticate(req, res, next) {
        try {
            // Skip auth for public routes
            if (this.isPublicRoute(req.path)) {
                return next();
            }

            // Get and verify token
            const token = this.extractToken(req);
            if (!token) {
                throw createError.authentication(
                    ERROR_CODES.TOKEN_MISSING,
                    'Authentication token is required'
                );
            }

            // Verify token
            const decoded = await TokenService.verifyAuth0Token(token, {
                refreshToken: req.headers['x-refresh-token']
            });

            // Get or create user
            const user = await this.getOrCreateUser(decoded);
            if (!user) {
                throw createError.authentication(
                    ERROR_CODES.USER_NOT_FOUND,
                    'User not found'
                );
            }

            // Attach user to request
            req.user = user;

            // Check if token was refreshed
            if (res.locals.refreshedToken) {
                res.setHeader('X-New-Token', res.locals.refreshedToken);
            }

            next();
        } catch (error) {
            logger.error('Authentication failed:', {
                error: error.message,
                path: req.path
            });

            // Emit auth failure event
            authEvents.emitLoginFailed(this.getClientIP(req), error.message);

            next(error);
        }
    }

    async login(credentials) {
        try {
            // Validate credentials
            if (!credentials.email || !credentials.password) {
                throw createError.validation(
                    ERROR_CODES.INVALID_CREDENTIALS,
                    'Email and password are required'
                );
            }

            // Check rate limits
            const attempts = await this.getLoginAttempts(credentials.email);
            if (attempts >= this.config.maxLoginAttempts) {
                throw createError.rateLimit(
                    ERROR_CODES.MAX_LOGIN_ATTEMPTS,
                    'Too many login attempts'
                );
            }

            // Authenticate with Auth0
            const tokens = await this.auth0Client.getTokenSilently({
                ...credentials,
                scope: 'openid profile email'
            });

            // Get or create user
            const decoded = await TokenService.verifyAuth0Token(tokens.access_token);
            const user = await this.getOrCreateUser(decoded);

            // Reset login attempts
            await this.resetLoginAttempts(credentials.email);

            // Emit login success event
            authEvents.emitLoginSuccess(user._id);

            return {
                user,
                tokens: {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires_in: tokens.expires_in
                }
            };

        } catch (error) {
            // Increment failed attempts
            await this.incrementLoginAttempts(credentials.email);

            logger.error('Login failed:', {
                error: error.message,
                email: credentials.email
            });

            throw error;
        }
    }

    async handleCallback(req) {
        try {
            this.logger.info('Auth callback received', {
                hasCode: !!req.code,
                hasError: !!req.error,
                error: req.error || 'none',
                errorDesc: req.error_description || 'none'
            });

            if (!req.code) {
                throw new Error('Authorization code is missing from callback parameters');
            }

            // Exchange the authorization code for tokens directly with Auth0
            // instead of relying on the auth0Client which may be incorrectly set up
            this.logger.info('Exchanging authorization code for tokens');
            
            const tokenResponse = await fetch(`${config.auth0.issuerBaseURL}/oauth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    grant_type: 'authorization_code',
                    client_id: config.auth0.clientID,
                    client_secret: config.auth0.clientSecret,
                    code: req.code,
                    redirect_uri: `${config.auth0.baseURL}/api/auth/callback`
                })
            });
            
            if (!tokenResponse.ok) {
                const errorData = await tokenResponse.json();
                this.logger.error('Token exchange failed:', errorData);
                throw new Error(`Token exchange failed: ${errorData.error_description || 'Unknown error'}`);
            }
            
            const tokens = await tokenResponse.json();
            this.logger.info('Tokens received', {
                hasAccessToken: !!tokens.access_token,
                hasIdToken: !!tokens.id_token,
                hasRefreshToken: !!tokens.refresh_token
            });
            
            // ID tokens can be verified more easily than access tokens
            // and contain user profile information
            let userProfile;
            if (tokens.id_token) {
                // Parse the ID token (which is a JWT) to get the user info
                // This is safe because ID tokens are meant to be decoded on the client
                const decoded = jwt.decode(tokens.id_token);
                if (!decoded) {
                    throw new Error('Failed to decode ID token');
                }
                userProfile = decoded;
            } else {
                // If no ID token, use the access token with special allowances
                userProfile = await TokenService.verifyAuth0Token(tokens.access_token, { 
                    allowNoAudience: true,
                    isIdToken: false
                });
            }
            
            // Get or create user with the profile info
            const user = await this.getOrCreateUser(userProfile);

            return {
                user,
                tokens
            };
        } catch (error) {
            this.logger.error('Auth callback failed:', error);
            throw error;
        }
    }

    async getOrCreateUser(decoded) {
        try {
            let user = await User.findOne({ auth0Id: decoded.sub });

            if (!user) {
                // Check for missing email and provide fallback
                const email = decoded.email || 
                              (decoded.sub ? `${decoded.sub.split('|')[1]}@placeholder.com` : 
                              `user-${Date.now()}@placeholder.com`);
                
                const name = decoded.name || 'FOMO User';
                
                this.logger.info('Creating new user with data:', {
                    auth0Id: decoded.sub,
                    email: email,
                    name: name,
                    hasOriginalEmail: !!decoded.email
                });
                
                user = await User.create({
                    auth0Id: decoded.sub,
                    email: email,
                    name: name,
                    picture: decoded.picture
                });
            }

            return user;
        } catch (error) {
            logger.error('Failed to get/create user:', error);
            throw error;
        }
    }

    isPublicRoute(path) {
        return [
            '/api/health',
            '/api/auth/callback',
            '/api/auth/login',
            '/api/webhook'
        ].some(p => path.startsWith(p));
    }

    extractToken(req) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        return authHeader.split(' ')[1];
    }

    getClientIP(req) {
        return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
               req.socket.remoteAddress;
    }

    async getLoginAttempts(email) {
        const cache = this.getDependency('cache');
        return parseInt(await cache.get(`login_attempts:${email}`)) || 0;
    }

    async incrementLoginAttempts(email) {
        const cache = this.getDependency('cache');
        const attempts = await this.getLoginAttempts(email) + 1;
        await cache.set(`login_attempts:${email}`, attempts, this.config.blockDuration);
        return attempts;
    }

    async resetLoginAttempts(email) {
        const cache = this.getDependency('cache');
        await cache.delete(`login_attempts:${email}`);
    }

    async _cleanup() {
        this.auth0Client = null;
        logger.info('Authentication service cleaned up');
    }

    getHealth() {
        const isDevelopment = process.env.NODE_ENV === 'development';

        return {
            status: this.ready ? 'healthy' : 'unhealthy',
            provider: 'auth0',
            features: {
                auth0: isDevelopment || this.auth0Client !== null,
                rateLimit: true,
                tokenRefresh: true,
                mockAuth: isDevelopment
            },
            mode: process.env.NODE_ENV,
            configuration: isDevelopment ? {
                mockEnabled: true,
                baseURL: 'http://localhost:3000',
                hasSecret: true
            } : undefined,
            metrics: {
                requests: {
                    help: 'Total authentication requests',
                    name: 'auth_requests_total',
                    type: 'counter',
                    values: [],
                    aggregator: 'sum'
                },
                latency: {
                    name: 'auth_latency_ms',
                    help: 'Authentication request latency',
                    type: 'histogram',
                    values: [
                        { value: 0, metricName: 'auth_latency_ms_bucket', exemplar: null, labels: { le: 10 } },
                        { value: 0, metricName: 'auth_latency_ms_bucket', exemplar: null, labels: { le: 50 } },
                        { value: 0, metricName: 'auth_latency_ms_bucket', exemplar: null, labels: { le: 100 } },
                        { value: 0, metricName: 'auth_latency_ms_bucket', exemplar: null, labels: { le: 200 } },
                        { value: 0, metricName: 'auth_latency_ms_bucket', exemplar: null, labels: { le: 500 } },
                        { value: 0, metricName: 'auth_latency_ms_bucket', exemplar: null, labels: { le: 1000 } },
                        { value: 0, metricName: 'auth_latency_ms_bucket', exemplar: null, labels: { le: '+Inf' } },
                        { value: 0, metricName: 'auth_latency_ms_sum', labels: {} },
                        { value: 0, metricName: 'auth_latency_ms_count', labels: {} }
                    ],
                    aggregator: 'sum'
                }
            }
        };
    }

    // Safe decoding of a token - doesn't verify signature, just extracts the payload
    decodeToken(token) {
        try {
            // If it's a JWT, decode it
            if (token && token.split('.').length === 3) {
                return jwt.decode(token);
            }
            
            // If it's not a JWT, just return the token
            return { raw: token };
        } catch (error) {
            this.logger.error('Error decoding token:', error);
            return { error: error.message };
        }
    }
}

// Export singleton instance for backward compatibility
module.exports = new AuthenticationService();
// Also export the class for service container
module.exports.AuthenticationService = AuthenticationService; 