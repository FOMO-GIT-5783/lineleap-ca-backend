const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');
const { config } = require('../config/environment.cjs');
const logger = require('./logger.cjs');
const BaseService = require('./baseService.cjs');
const { AUTH_EVENTS } = require('./authEvents.cjs');
const { createError, ERROR_CODES } = require('./errors.cjs');

// Validate JWT secret
if (!config.jwt?.secret) {
    throw new Error('JWT_SECRET is required. Check your environment configuration.');
}

// Maintain singleton for backward compatibility
let instance = null;

class TokenService extends BaseService {
    constructor(serviceConfig = {}) {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('token-service');
        
        this.config = {
            tokenExpiry: '1h',
            refreshTokenExpiry: '7d',
            ...serviceConfig
        };

        // Initialize JWKS client for Auth0
        this.jwksClient = jwksRsa({
            jwksUri: `${config.auth0.issuerBaseURL}/.well-known/jwks.json`,
            cache: true,
            rateLimit: true
        });

        instance = this;
    }

    async _init() {
        // Verify we can fetch JWKS
        try {
            await this.jwksClient.getSigningKeys();
            logger.info('JWKS client initialized successfully');
            return true;
        } catch (error) {
            logger.error('Failed to initialize JWKS client:', error);
            throw error;
        }
    }

    async verifyAuth0Token(token, options = {}) {
        if (!token) {
            throw createError.authentication(
                ERROR_CODES.TOKEN_MISSING,
                'Token is required'
            );
        }

        try {
            // Get key ID from token header
            const decoded = jwt.decode(token, { complete: true });
            
            // Enhanced logging to diagnose token structure
            logger.info('Token structure analysis', {
                hasHeader: !!decoded?.header,
                hasPayload: !!decoded?.payload,
                headerKeys: decoded?.header ? Object.keys(decoded.header) : [],
                tokenType: options.isIdToken ? 'id_token' : 'access_token',
                allowNoAudience: !!options.allowNoAudience
            });
            
            if (!decoded) {
                throw createError.authentication(
                    ERROR_CODES.TOKEN_INVALID,
                    'Unable to decode token - invalid format'
                );
            }
            
            // If this is an ID token or we're explicitly allowing tokens without a kid
            if (options.isIdToken || options.allowNoAudience) {
                logger.info('Processing token with relaxed validation', {
                    isIdToken: !!options.isIdToken,
                    allowNoAudience: !!options.allowNoAudience
                });
                
                // For ID tokens or when explicitly allowing tokens without audience,
                // we can return the decoded payload directly
                if (decoded.payload) {
                    return decoded.payload;
                }
                
                // If token doesn't have the expected structure but we can still get basic JWT format
                const basicDecoded = jwt.decode(token);
                if (basicDecoded) {
                    return basicDecoded;
                }
                
                throw createError.authentication(
                    ERROR_CODES.TOKEN_INVALID,
                    'Unable to decode token payload'
                );
            }
            
            // Regular token validation flow for access tokens
            if (!decoded.header.kid) {
                throw createError.authentication(
                    ERROR_CODES.TOKEN_INVALID,
                    'Invalid token format: missing key ID (kid)'
                );
            }

            // Get signing key
            const key = await this.jwksClient.getSigningKey(decoded.header.kid);
            const signingKey = key.getPublicKey();

            // Set up verification options
            const verifyOptions = {
                algorithms: ['RS256'],
                issuer: config.auth0.issuerBaseURL
            };
            
            // Only check audience if we're not allowing no-audience tokens
            if (!options.allowNoAudience) {
                verifyOptions.audience = config.auth0.audience;
            }

            // Verify token
            const verified = jwt.verify(token, signingKey, verifyOptions);

            // Check if token needs refresh
            if (this.shouldRefreshToken(verified)) {
                if (options.refreshToken) {
                    return this.refreshToken(options.refreshToken);
                }
                logger.debug('Token needs refresh but no refresh token provided');
            }

            return verified;

        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                throw createError.authentication(
                    ERROR_CODES.TOKEN_EXPIRED,
                    'Token has expired'
                );
            }

            logger.error('Token verification failed:', {
                error: error.message,
                code: error.code,
                name: error.name,
                stack: error.stack
            });

            throw createError.authentication(
                ERROR_CODES.TOKEN_INVALID,
                `Invalid token: ${error.message}`
            );
        }
    }

    async refreshToken(refreshToken) {
        try {
            // Call Auth0's token endpoint to refresh the token
            const response = await fetch(`${config.auth0.issuerBaseURL}/oauth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    client_id: config.auth0.clientID,
                    client_secret: config.auth0.clientSecret,
                    refresh_token: refreshToken
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error_description || 'Failed to refresh token');
            }

            const tokens = await response.json();

            // Verify the new access token
            const decoded = await this.verifyAuth0Token(tokens.access_token);

            return {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                decoded
            };

        } catch (error) {
            logger.error('Token refresh failed:', error);
            throw createError.authentication(
                ERROR_CODES.TOKEN_REFRESH_FAILED,
                'Failed to refresh token'
            );
        }
    }

    shouldRefreshToken(decoded) {
        const now = Math.floor(Date.now() / 1000);
        const expiresIn = decoded.exp - now;
        // Refresh if token expires in less than 5 minutes
        return expiresIn < 300;
    }

    async blacklistToken(token) {
        const decoded = jwt.decode(token);
        if (!decoded) {
            throw createError.validation(
                ERROR_CODES.TOKEN_INVALID,
                'Invalid token format'
            );
        }

        // Store in blacklist with expiry
        const exp = decoded.exp * 1000; // Convert to milliseconds
        const ttl = exp - Date.now();

        if (ttl > 0) {
            const cache = this.getDependency('cache');
            await cache.set(`blacklist:${token}`, true, ttl);
        }
    }

    async isTokenBlacklisted(token) {
        const cache = this.getDependency('cache');
        return await cache.get(`blacklist:${token}`);
    }

    getHealth() {
        return {
            status: this.isReady() ? 'healthy' : 'unhealthy',
            jwksClientReady: !!this.jwksClient,
            provider: 'auth0',
            configuration: {
                issuerBaseURL: config.auth0.issuerBaseURL,
                audience: config.auth0.audience,
                hasClientSecret: !!config.auth0.clientSecret
            }
        };
    }
}

// Export singleton instance
module.exports = new TokenService(); 