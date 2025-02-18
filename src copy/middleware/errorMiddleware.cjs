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
        return createError.validation(
            ERROR_CODES.VALIDATION_ERROR,
            'Validation failed',
            Object.keys(err.errors).reduce((acc, key) => {
                acc[key] = err.errors[key].message;
                return acc;
            }, {})
        );
    }

    // MongoDB errors
    if (err.name === 'MongoError' || err.name === 'MongoServerError') {
        if (err.code === 11000) {
            return createError.business(
                ERROR_CODES.RESOURCE_EXISTS,
                'Resource already exists',
                { duplicate: Object.keys(err.keyPattern) }
            );
        }
        return createError.database(
            ERROR_CODES.DATABASE_ERROR,
            'Database operation failed'
        );
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return createError.authentication(
            ERROR_CODES.INVALID_TOKEN,
            'Invalid token'
        );
    }
    if (err.name === 'TokenExpiredError') {
        return createError.authentication(
            ERROR_CODES.TOKEN_EXPIRED,
            'Token has expired'
        );
    }

    // Stripe errors
    if (err.type && err.type.startsWith('Stripe')) {
        return createError.payment(
            ERROR_CODES.PAYMENT_FAILED,
            err.message,
            { stripeCode: err.code }
        );
    }

    // Default to internal error
    return createError.internal(
        process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message
    );
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
    // Ensure we have a valid status code
    const statusCode = err.status || err.statusCode || 500;
    
    // Normalize the error
    const normalizedError = {
        status: 'error',
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || 'An unexpected error occurred'
    };

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development') {
        normalizedError.stack = err.stack;
    }

    // Log the error
    console.error('Error occurred:', {
        error: normalizedError,
        request: {
            method: req.method,
            url: req.url,
            ip: req.ip,
            userId: req.user?._id
        }
    });

    // Send response
    res.status(statusCode).json(normalizedError);
};

module.exports = {
    requestLogger,
    errorHandler
}; 