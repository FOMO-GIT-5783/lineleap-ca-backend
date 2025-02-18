const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');
const { config } = require('../config/environment.cjs');
const logger = require('./logger.cjs');
const BaseService = require('./baseService.cjs');
const { AUTH_EVENTS } = require('./authEvents.cjs');
const { createError, ERROR_CODES } = require('./errors.cjs');

// Validate JWT secret
if (!config.jwt.secret) {
    throw new Error('JWT secret not configured. Check your environment configuration.');
}

// Maintain singleton for backward compatibility
let instance = null;

class TokenService extends BaseService {
    constructor(serviceConfig = {}) {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('token-service', {}, serviceConfig);
        
        // Initialize instance variables
        this.jwksClient = null;
        this.tokenCache = new Map();
        this.refreshTokens = new Map();
        
        // Token configuration
        this.config = {
            accessTokenTTL: 3600, // 1 hour
            refreshTokenTTL: 2592000, // 30 days
            refreshBeforeExpiry: 300 // 5 minutes
        };
        
        instance = this;
    }

    async _init() {
        try {
            const events = this.getDependency('events');
            if (!events) {
                throw new Error('Events system required for token service');
            }

            // Initialize JWKS client
            this.jwksClient = jwksRsa({
                jwksUri: `${config.auth0.issuerBaseURL}/.well-known/jwks.json`,
                cache: true,
                rateLimit: true
            });

            // Set up event handlers
            events.safeOn(AUTH_EVENTS.SESSION_CREATED, this.handleSessionCreated.bind(this));
            events.safeOn(AUTH_EVENTS.SESSION_EXPIRED, this.handleSessionExpired.bind(this));

            // Start token cleanup job
            this.startTokenCleanup();

            logger.info('Token service initialized');
            return true;
        } catch (error) {
            logger.error('Failed to initialize token service:', error);
            throw error;
        }
    }

    async verifyAuth0Token(token, options = {}) {
        if (!token) {
            throw createError.validation(
                ERROR_CODES.TOKEN_MISSING,
                'Token is required'
            );
        }

        try {
            // Check cache first
            const cachedToken = this.tokenCache.get(token);
            if (cachedToken) {
                // Check if token is near expiry
                if (this.shouldRefreshToken(cachedToken)) {
                    return this.refreshToken(token);
                }
                return cachedToken;
            }

            const decoded = jwt.decode(token, { complete: true });
            if (!decoded || !decoded.header.kid) {
                throw createError.validation(
                    ERROR_CODES.TOKEN_INVALID,
                    'Invalid token format: missing key ID (kid)'
                );
            }

            const key = await this.jwksClient.getSigningKey(decoded.header.kid);
            const signingKey = key.getPublicKey();

            const verified = jwt.verify(token, signingKey, {
                algorithms: ['RS256'],
                audience: config.auth0.audience,
                issuer: config.auth0.issuerBaseURL + '/',
                ...options
            });

            // Check token expiry
            if (this.isTokenExpired(verified)) {
                throw createError.authentication(
                    ERROR_CODES.TOKEN_EXPIRED,
                    'Token has expired'
                );
            }

            // Cache successful verifications with TTL
            this.tokenCache.set(token, verified);
            
            // Store refresh token if provided
            if (options.refreshToken) {
                this.refreshTokens.set(token, options.refreshToken);
            }

            return verified;
        } catch (error) {
            logger.error('Token verification failed:', {
                error: error.message,
                code: error.code
            });

            if (error.name === 'TokenExpiredError') {
                // Try to refresh if possible
                if (this.refreshTokens.has(token)) {
                    return this.refreshToken(token);
                }
                throw createError.authentication(
                    ERROR_CODES.TOKEN_EXPIRED,
                    'Token has expired'
                );
            }

            throw createError.authentication(
                ERROR_CODES.TOKEN_INVALID,
                'Invalid token'
            );
        }
    }

    isTokenExpired(decoded) {
        const now = Math.floor(Date.now() / 1000);
        return decoded.exp <= now;
    }

    shouldRefreshToken(decoded) {
        const now = Math.floor(Date.now() / 1000);
        return decoded.exp - now <= this.config.refreshBeforeExpiry;
    }

    async refreshToken(token) {
        const refreshToken = this.refreshTokens.get(token);
        if (!refreshToken) {
            throw createError.authentication(
                ERROR_CODES.REFRESH_TOKEN_MISSING,
                'Refresh token not found'
            );
        }

        try {
            // Call Auth0 to refresh token
            const response = await fetch(`${config.auth0.issuerBaseURL}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    client_id: config.auth0.clientID,
                    client_secret: config.auth0.clientSecret,
                    refresh_token: refreshToken
                })
            });

            if (!response.ok) {
                throw new Error('Failed to refresh token');
            }

            const data = await response.json();
            
            // Verify new token
            const newToken = await this.verifyAuth0Token(data.access_token, {
                refreshToken: data.refresh_token
            });

            // Update caches
            this.tokenCache.delete(token);
            this.refreshTokens.delete(token);
            
            // Emit token refreshed event
            const events = this.getDependency('events');
            events?.emit(AUTH_EVENTS.TOKEN_REFRESHED, {
                oldToken: token,
                newToken: data.access_token
            });

            return newToken;
        } catch (error) {
            logger.error('Token refresh failed:', error);
            throw createError.authentication(
                ERROR_CODES.TOKEN_REFRESH_FAILED,
                'Failed to refresh token'
            );
        }
    }

    startTokenCleanup() {
        setInterval(() => {
            const now = Math.floor(Date.now() / 1000);
            
            // Cleanup token cache
            for (const [token, decoded] of this.tokenCache.entries()) {
                if (this.isTokenExpired(decoded)) {
                    this.tokenCache.delete(token);
                    this.refreshTokens.delete(token);
                }
            }
            
            // Log cleanup metrics
            logger.debug('Token cleanup completed', {
                activeSessions: this.tokenCache.size,
                refreshTokens: this.refreshTokens.size
            });
        }, 60000); // Run every minute
    }

    async handleSessionCreated(data) {
        const { token } = data;
        if (token) {
            this.tokenCache.set(token, true);
        }
    }

    async handleSessionExpired(data) {
        const { token } = data;
        if (token) {
            this.tokenCache.delete(token);
        }
    }

    async _cleanup() {
        this.tokenCache.clear();
        logger.info('Token service cleaned up');
    }

    getHealth() {
        return {
            status: this.isReady() ? 'healthy' : 'unhealthy',
            cacheSize: this.tokenCache.size,
            refreshTokens: this.refreshTokens.size,
            jwksClientReady: !!this.jwksClient
        };
    }
}

module.exports = new TokenService(); 