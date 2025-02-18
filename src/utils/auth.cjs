const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');
const { config } = require('../config/environment.cjs');
const logger = require('./logger.cjs');
const BaseService = require('./baseService.cjs');
const { AUTH_EVENTS } = require('./authEvents.cjs');
const { createError, ERROR_CODES } = require('./errors.cjs');

// Validate JWT secret
if (!config.jwt?.secret) {
    config.jwt = {
        secret: process.env.JWT_SECRET || 'development-secret-key'
    };
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
            if (!decoded || !decoded.header.kid) {
                throw createError.authentication(
                    ERROR_CODES.TOKEN_INVALID,
                    'Invalid token format: missing key ID (kid)'
                );
            }

            // Get signing key
            const key = await this.jwksClient.getSigningKey(decoded.header.kid);
            const signingKey = key.getPublicKey();

            // Verify token
            const verified = jwt.verify(token, signingKey, {
                algorithms: ['RS256'],
                audience: config.auth0.audience,
                issuer: config.auth0.issuerBaseURL
            });

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
                code: error.code
            });

            throw createError.authentication(
                ERROR_CODES.TOKEN_INVALID,
                'Invalid token'
            );
        }
    }

    shouldRefreshToken(decoded) {
        const now = Math.floor(Date.now() / 1000);
        const exp = decoded.exp;
        const refreshThreshold = 300; // 5 minutes

        return exp - now < refreshThreshold;
    }

    async refreshToken(refreshToken) {
        try {
            // Verify refresh token
            const decoded = jwt.verify(refreshToken, config.jwt.secret);

            // Create new access token
            const accessToken = jwt.sign(
                {
                    sub: decoded.sub,
                    email: decoded.email
                },
                config.jwt.secret,
                { expiresIn: this.config.tokenExpiry }
            );

            return {
                accessToken,
                decoded: jwt.decode(accessToken)
            };

        } catch (error) {
            logger.error('Token refresh failed:', error);
            throw createError.authentication(
                ERROR_CODES.TOKEN_REFRESH_FAILED,
                'Failed to refresh token'
            );
        }
    }

    async generateToken(user, options = {}) {
        try {
            const token = jwt.sign(
                {
                    sub: user._id,
                    email: user.email,
                    roles: user.roles
                },
                config.jwt.secret,
                {
                    expiresIn: options.expiresIn || this.config.tokenExpiry
                }
            );

            // Generate refresh token if requested
            let refreshToken;
            if (options.withRefreshToken) {
                refreshToken = jwt.sign(
                    { sub: user._id },
                    config.jwt.secret,
                    { expiresIn: this.config.refreshTokenExpiry }
                );
            }

            return {
                token,
                refreshToken,
                expiresIn: jwt.decode(token).exp
            };

        } catch (error) {
            logger.error('Token generation failed:', error);
            throw createError.service(
                ERROR_CODES.TOKEN_GENERATION_FAILED,
                'Failed to generate token'
            );
        }
    }

    async revokeToken(token) {
        try {
            // Add token to blacklist
            await this.blacklistToken(token);
            logger.info('Token revoked successfully');
            return true;
        } catch (error) {
            logger.error('Token revocation failed:', error);
            throw createError.service(
                ERROR_CODES.TOKEN_REVOCATION_FAILED,
                'Failed to revoke token'
            );
        }
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
            config: {
                tokenExpiry: this.config.tokenExpiry,
                refreshTokenExpiry: this.config.refreshTokenExpiry
            }
        };
    }
}

// Export singleton instance for backward compatibility
module.exports = new TokenService();
// Also export the class for service container
module.exports.TokenService = TokenService; 