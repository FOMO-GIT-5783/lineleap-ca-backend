const { AppError, ERROR_CODES, createError } = require('../utils/errors.cjs');
const logger = require('../utils/logger.cjs');
const { logRequest, logError } = require('../utils/logger.cjs');

// Request logging middleware
const requestLogger = (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logRequest(req, duration);
    });
    next();
};

// Convert various error types to AppError
const normalizeError = (err) => {
    // Already normalized
    if (err instanceof AppError) {
        return err;
    }

    // Mongoose validation errors
    if (err.name === 'ValidationError') {
        return createError.validation('validation/error', 'Validation failed', {
            details: Object.keys(err.errors).reduce((acc, key) => {
                acc[key] = err.errors[key].message;
                return acc;
            }, {})
        });
    }

    // MongoDB errors
    if (err.name === 'MongoError' || err.name === 'MongoServerError') {
        if (err.code === 11000) {
            return createError.business('resource/already-exists', 'Resource already exists', {
                details: { fields: Object.keys(err.keyPattern) }
            });
        }
        return createError.service('database/error', 'Database operation failed');
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return createError.authentication('auth/token-invalid', 'Invalid token');
    }
    if (err.name === 'TokenExpiredError') {
        return createError.authentication('auth/token-expired', 'Token has expired');
    }

    // Stripe errors
    if (err.type && err.type.startsWith('Stripe')) {
        return createError.business('payment/failed', err.message, {
            details: { stripeCode: err.code }
        });
    }

    // Default to internal error
    return createError.service(
        'system/error',
        process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
    );
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
    // Normalize the error
    const normalizedError = normalizeError(err);
    
    // Get frontend-friendly response
    const errorResponse = normalizedError.toResponse();

    // Add request context for logging
    const logContext = {
        ...normalizedError.getLogContext(),
        request: {
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            userId: req.user?._id
        }
    };

    // Log based on severity
    switch (normalizedError.severity) {
        case 'critical':
            logger.error('Critical error occurred:', logContext);
            break;
        case 'error':
            logger.error('Error occurred:', logContext);
            break;
        case 'warning':
            logger.warn('Warning occurred:', logContext);
            break;
        default:
            logger.info('Info error occurred:', logContext);
    }

    // Send response
    res.status(normalizedError.statusCode).json(errorResponse);
};

module.exports = {
    requestLogger,
    errorHandler
}; 