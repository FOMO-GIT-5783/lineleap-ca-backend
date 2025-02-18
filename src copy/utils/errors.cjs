const ERROR_CODES = {
    // System Errors
    SERVICE_NOT_READY: 'SERVICE_NOT_READY',
    SERVICE_INIT_FAILED: 'SERVICE_INIT_FAILED',
    SERVICE_CLEANUP_FAILED: 'SERVICE_CLEANUP_FAILED',
    MISSING_DEPENDENCIES: 'MISSING_DEPENDENCIES',
    INVALID_CONFIG: 'INVALID_CONFIG',
    CIRCUIT_BREAKER_OPEN: 'CIRCUIT_BREAKER_OPEN',

    // WebSocket Errors
    WEBSOCKET_CONNECTION_ERROR: 'WEBSOCKET_CONNECTION_ERROR',
    WEBSOCKET_MESSAGE_ERROR: 'WEBSOCKET_MESSAGE_ERROR',
    WEBSOCKET_COMPRESSION_ERROR: 'WEBSOCKET_COMPRESSION_ERROR',
    WEBSOCKET_RATE_LIMIT: 'WEBSOCKET_RATE_LIMIT',
    WEBSOCKET_AUTH_ERROR: 'WEBSOCKET_AUTH_ERROR',

    // Transaction Errors
    TRANSACTION_START_FAILED: 'TRANSACTION_START_FAILED',
    TRANSACTION_COMMIT_FAILED: 'TRANSACTION_COMMIT_FAILED',
    TRANSACTION_ROLLBACK_FAILED: 'TRANSACTION_ROLLBACK_FAILED',
    TRANSACTION_TIMEOUT: 'TRANSACTION_TIMEOUT',
    TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',

    // Payment Errors
    PAYMENT_FAILED: 'PAYMENT_FAILED',
    PAYMENT_VALIDATION_FAILED: 'PAYMENT_VALIDATION_FAILED',
    PAYMENT_PROCESSING_ERROR: 'PAYMENT_PROCESSING_ERROR',
    PAYMENT_ROLLBACK_FAILED: 'PAYMENT_ROLLBACK_FAILED',
    DUPLICATE_PAYMENT: 'DUPLICATE_PAYMENT',
    INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
    INVALID_PAYMENT_METHOD: 'INVALID_PAYMENT_METHOD',

    // Order Errors
    ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
    ORDER_VALIDATION_FAILED: 'ORDER_VALIDATION_FAILED',
    ORDER_PROCESSING_ERROR: 'ORDER_PROCESSING_ERROR',
    ORDER_ALREADY_PROCESSED: 'ORDER_ALREADY_PROCESSED',
    ORDER_LOCK_FAILED: 'ORDER_LOCK_FAILED',

    // Authentication Errors
    AUTH_FAILED: 'AUTH_FAILED',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    TOKEN_INVALID: 'TOKEN_INVALID',
    TOKEN_MISSING: 'TOKEN_MISSING',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',

    // Validation Errors
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',
    MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
    INVALID_FORMAT: 'INVALID_FORMAT',

    // Rate Limiting Errors
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',

    // Database Errors
    DB_ERROR: 'DB_ERROR',
    DB_CONNECTION_ERROR: 'DB_CONNECTION_ERROR',
    DB_QUERY_ERROR: 'DB_QUERY_ERROR',
    DB_WRITE_ERROR: 'DB_WRITE_ERROR',
    DB_READ_ERROR: 'DB_READ_ERROR',

    // Cache Errors
    CACHE_ERROR: 'CACHE_ERROR',
    CACHE_MISS: 'CACHE_MISS',
    CACHE_WRITE_ERROR: 'CACHE_WRITE_ERROR',
    CACHE_READ_ERROR: 'CACHE_READ_ERROR',

    // External Service Errors
    EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
    API_ERROR: 'API_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',

    // Business Logic Errors
    BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
    INSUFFICIENT_INVENTORY: 'INSUFFICIENT_INVENTORY',
    INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
    OPERATION_NOT_ALLOWED: 'OPERATION_NOT_ALLOWED',

    // New error codes
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
    TRANSACTION_ERROR: 'TRANSACTION_ERROR',
    WEBSOCKET_ERROR: 'WEBSOCKET_ERROR'
};

// Error severity levels for better logging and monitoring
const ERROR_SEVERITY = {
    LOW: 'low',         // Non-critical, expected errors
    MEDIUM: 'medium',   // Important but not critical
    HIGH: 'high',       // Critical errors requiring immediate attention
    FATAL: 'fatal'      // System-breaking errors
};

// Error categories for better organization and monitoring
const ERROR_CATEGORIES = {
    SECURITY: 'security',
    PAYMENT: 'payment',
    DATABASE: 'database',
    VALIDATION: 'validation',
    BUSINESS: 'business',
    SYSTEM: 'system',
    EXTERNAL: 'external',
    WEBSOCKET: 'websocket',
    TRANSACTION: 'transaction'
};

class AppError extends Error {
    constructor(code, message, statusCode = 500, data = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.data = data;
        this.timestamp = new Date();
        this.severity = data.severity || ERROR_SEVERITY.MEDIUM;
        this.category = data.category || ERROR_CATEGORIES.SYSTEM;
        this.context = data.context || {};
        this.retryable = data.retryable ?? false;
        this.source = data.source || 'unknown';
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            error: {
                name: this.name,
                code: this.code,
                message: this.message,
                statusCode: this.statusCode,
                severity: this.severity,
                category: this.category,
                context: this.context,
                retryable: this.retryable,
                source: this.source,
                timestamp: this.timestamp,
                stack: process.env.NODE_ENV === 'development' ? this.stack : undefined
            }
        };
    }

    getLogContext() {
        return {
            errorName: this.name,
            errorCode: this.code,
            severity: this.severity,
            category: this.category,
            source: this.source,
            context: this.context,
            retryable: this.retryable,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

// Enhanced error classes with better context
class WebSocketError extends AppError {
    constructor(code, message, data = {}) {
        super(code, message, 500, {
            ...data,
            category: ERROR_CATEGORIES.WEBSOCKET,
            retryable: true // Most WebSocket errors can be retried
        });
    }
}

class TransactionError extends AppError {
    constructor(code, message, data = {}) {
        super(code, message, 500, {
            ...data,
            category: ERROR_CATEGORIES.TRANSACTION,
            retryable: data.retryable ?? true
        });
        this.transactionId = data.transactionId;
        this.rollbackRequired = data.rollbackRequired ?? true;
    }

    toJSON() {
        return {
            ...super.toJSON(),
            transactionId: this.transactionId,
            rollbackRequired: this.rollbackRequired
        };
    }
}

// Error boundary for async operations
const withErrorBoundary = async (operation, context = {}) => {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        
        // Convert unknown errors to AppError
        throw new AppError(
            ERROR_CODES.UNKNOWN_ERROR,
            error.message,
            500,
            {
                severity: ERROR_SEVERITY.HIGH,
                category: ERROR_CATEGORIES.SYSTEM,
                context,
                source: context.source || 'unknown',
                originalError: error
            }
        );
    }
};

// Transaction error boundary
const withTransactionBoundary = async (operation, context = {}) => {
    const transactionId = context.transactionId;
    try {
        return await operation();
    } catch (error) {
        if (error instanceof TransactionError) {
            throw error;
        }
        
        throw new TransactionError(
            ERROR_CODES.TRANSACTION_ERROR,
            error.message,
            {
                transactionId,
                severity: ERROR_SEVERITY.HIGH,
                context,
                source: context.source,
                rollbackRequired: true,
                originalError: error
            }
        );
    }
};

// WebSocket error boundary
const withWebSocketBoundary = async (operation, context = {}) => {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof WebSocketError) {
            throw error;
        }
        
        throw new WebSocketError(
            ERROR_CODES.WEBSOCKET_ERROR,
            error.message,
            {
                severity: ERROR_SEVERITY.MEDIUM,
                context,
                source: context.source,
                socketId: context.socketId,
                retryable: true,
                originalError: error
            }
        );
    }
};

class ValidationError extends AppError {
    constructor(code = ERROR_CODES.VALIDATION_ERROR, message = 'Validation error', data = {}) {
        super(code, message, 400, data);
    }
}

class AuthenticationError extends AppError {
    constructor(code = ERROR_CODES.AUTH_FAILED, message = 'Authentication failed', data = {}) {
        super(code, message, 401, data);
    }
}

class AuthorizationError extends AppError {
    constructor(code = ERROR_CODES.FORBIDDEN, message = 'Access forbidden', data = {}) {
        super(code, message, 403, data);
    }
}

class NotFoundError extends AppError {
    constructor(code = ERROR_CODES.NOT_FOUND, message = 'Resource not found', data = {}) {
        super(code, message, 404, data);
    }
}

class ConflictError extends AppError {
    constructor(code = ERROR_CODES.CONFLICT, message = 'Resource conflict', data = {}) {
        super(code, message, 409, data);
    }
}

class RateLimitError extends AppError {
    constructor(code = ERROR_CODES.RATE_LIMIT_EXCEEDED, message = 'Rate limit exceeded', data = {}) {
        super(code, message, 429, data);
    }
}

class ServiceError extends AppError {
    constructor(code = ERROR_CODES.SERVICE_ERROR, message = 'Service error', data = {}) {
        super(code, message, 500, data);
    }
}

class DatabaseError extends AppError {
    constructor(code = ERROR_CODES.DB_ERROR, message = 'Database error', data = {}) {
        super(code, message, 500, data);
    }
}

class ExternalServiceError extends AppError {
    constructor(code = ERROR_CODES.EXTERNAL_SERVICE_ERROR, message = 'External service error', data = {}) {
        super(code, message, 502, data);
    }
}

// Error factory functions
const createError = {
    validation: (code, message, data) => new ValidationError(code, message, data),
    authentication: (code, message, data) => new AuthenticationError(code, message, data),
    authorization: (code, message, data) => new AuthorizationError(code, message, data),
    notFound: (code, message, data) => new NotFoundError(code, message, data),
    conflict: (code, message, data) => new ConflictError(code, message, data),
    rateLimit: (code, message, data) => new RateLimitError(code, message, data),
    service: (code, message, data) => new ServiceError(code, message, data),
    database: (code, message, data) => new DatabaseError(code, message, data),
    external: (code, message, data) => new ExternalServiceError(code, message, data),
    websocket: (code, message, data) => new WebSocketError(code, message, data),
    transaction: (code, message, data) => new TransactionError(code, message, data)
};

module.exports = {
    ERROR_CODES,
    ERROR_SEVERITY,
    ERROR_CATEGORIES,
    AppError,
    WebSocketError,
    TransactionError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    ServiceError,
    DatabaseError,
    ExternalServiceError,
    createError,
    withErrorBoundary,
    withTransactionBoundary,
    withWebSocketBoundary
}; 