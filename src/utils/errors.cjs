const ERROR_CODES = {
    // Authentication & Authorization
    AUTH_FAILED: 'auth/failed',
    TOKEN_EXPIRED: 'auth/token-expired',
    TOKEN_INVALID: 'auth/token-invalid',
    TOKEN_MISSING: 'auth/token-missing',
    UNAUTHORIZED: 'auth/unauthorized',
    FORBIDDEN: 'auth/forbidden',
    SESSION_EXPIRED: 'auth/session-expired',
    SESSION_INVALID: 'auth/session-invalid',

    // Validation & Input
    VALIDATION_ERROR: 'validation/error',
    INVALID_INPUT: 'validation/invalid-input',
    MISSING_REQUIRED_FIELD: 'validation/missing-field',
    INVALID_FORMAT: 'validation/invalid-format',

    // Resource Errors
    NOT_FOUND: 'resource/not-found',
    ALREADY_EXISTS: 'resource/already-exists',
    CONFLICT: 'resource/conflict',
    LOCKED: 'resource/locked',

    // Payment Errors
    PAYMENT_FAILED: 'payment/failed',
    PAYMENT_DECLINED: 'payment/declined',
    PAYMENT_EXPIRED: 'payment/expired',
    PAYMENT_CANCELLED: 'payment/cancelled',
    INSUFFICIENT_FUNDS: 'payment/insufficient-funds',
    INVALID_PAYMENT_METHOD: 'payment/invalid-method',

    // Rate Limiting
    RATE_LIMIT_EXCEEDED: 'rate-limit/exceeded',
    TOO_MANY_REQUESTS: 'rate-limit/too-many-requests',

    // Service Errors
    SERVICE_ERROR: 'service/error',
    SERVICE_UNAVAILABLE: 'service/unavailable',
    SERVICE_TIMEOUT: 'service/timeout',
    EXTERNAL_SERVICE_ERROR: 'service/external-error',

    // Database Errors
    DB_ERROR: 'database/error',
    DB_CONNECTION_ERROR: 'database/connection-error',
    DB_QUERY_ERROR: 'database/query-error',

    // Business Logic
    BUSINESS_RULE_VIOLATION: 'business/rule-violation',
    INVALID_STATE: 'business/invalid-state',
    OPERATION_NOT_ALLOWED: 'business/not-allowed',
    
    // WebSocket Errors
    WEBSOCKET_ERROR: 'websocket/error',
    WEBSOCKET_CONNECTION_ERROR: 'websocket/connection-error',
    WEBSOCKET_MESSAGE_ERROR: 'websocket/message-error',

    // Transaction Errors
    TRANSACTION_ERROR: 'transaction/error',
    TRANSACTION_FAILED: 'transaction/failed',
    TRANSACTION_TIMEOUT: 'transaction/timeout',

    // System Errors
    SYSTEM_ERROR: 'system/error',
    UNKNOWN_ERROR: 'system/unknown'
};

// Frontend-friendly error categories
const ERROR_CATEGORIES = {
    AUTH: 'auth',
    VALIDATION: 'validation',
    RESOURCE: 'resource',
    PAYMENT: 'payment',
    RATE_LIMIT: 'rate-limit',
    SERVICE: 'service',
    DATABASE: 'database',
    BUSINESS: 'business',
    WEBSOCKET: 'websocket',
    TRANSACTION: 'transaction',
    SYSTEM: 'system'
};

// Error severity for frontend handling
const ERROR_SEVERITY = {
    INFO: 'info',           // User information, can be displayed directly
    WARNING: 'warning',     // Warning that needs user attention
    ERROR: 'error',         // Error that needs user action
    CRITICAL: 'critical'    // Critical error, may need page reload/support
};

// Frontend action hints
const ERROR_ACTIONS = {
    RETRY: 'retry',             // Frontend can retry the operation
    RELOAD: 'reload',           // Frontend should reload the page
    REAUTH: 'reauth',           // User needs to re-authenticate
    CONTACT_SUPPORT: 'support', // User should contact support
    BACK: 'back',              // User should go back/cancel
    REFRESH: 'refresh'         // Frontend should refresh data
};

class AppError extends Error {
    constructor(code, message, statusCode = 500, data = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.category = this.#deriveCategory(code);
        this.severity = data.severity || this.#deriveSeverity(statusCode);
        this.action = data.action || this.#deriveAction(code);
        this.retryable = data.retryable ?? this.#isRetryable(code);
        this.userMessage = data.userMessage || this.#getUserMessage(message);
        this.details = data.details || {};
        this.timestamp = new Date().toISOString();
        
        // Development only properties
        if (process.env.NODE_ENV === 'development') {
            this.devInfo = {
                stack: this.stack,
                context: data.context || {},
                originalError: data.originalError
            };
        }
    }

    // Frontend-friendly error response
    toResponse() {
        const response = {
            status: 'error',
            error: {
                code: this.code,
                message: this.userMessage,
                category: this.category,
                severity: this.severity,
                action: this.action,
                retryable: this.retryable,
                details: this.details,
                timestamp: this.timestamp
            }
        };

        // Add development information if in dev mode
        if (process.env.NODE_ENV === 'development') {
            response.error.dev = this.devInfo;
        }

        return response;
    }

    // Internal helper methods
    #deriveCategory(code) {
        return code.split('/')[0];
    }

    #deriveSeverity(statusCode) {
        if (statusCode >= 500) return ERROR_SEVERITY.CRITICAL;
        if (statusCode >= 400) return ERROR_SEVERITY.ERROR;
        return ERROR_SEVERITY.WARNING;
    }

    #deriveAction(code) {
        if (code.startsWith('auth/')) return ERROR_ACTIONS.REAUTH;
        if (code.startsWith('rate-limit/')) return ERROR_ACTIONS.RETRY;
        if (code.startsWith('service/')) return ERROR_ACTIONS.RELOAD;
        return null;
    }

    #isRetryable(code) {
        const nonRetryable = [
            'auth/',
            'validation/',
            'resource/already-exists',
            'resource/conflict',
            'payment/insufficient-funds',
            'payment/invalid-method'
        ];
        return !nonRetryable.some(prefix => code.startsWith(prefix));
    }

    #getUserMessage(message) {
        // Convert technical message to user-friendly message
        // This can be expanded with more specific mappings
        const userMessages = {
            'auth/failed': 'Please log in again to continue.',
            'auth/token-expired': 'Your session has expired. Please log in again.',
            'validation/missing-field': 'Please fill in all required fields.',
            'payment/failed': 'Your payment could not be processed. Please try again.',
            'rate-limit/exceeded': 'Please wait a moment before trying again.',
            'service/unavailable': 'This service is temporarily unavailable. Please try again later.'
        };

        return userMessages[this.code] || message;
    }

    // Logging context
    getLogContext() {
        return {
            code: this.code,
            message: this.message,
            category: this.category,
            severity: this.severity,
            statusCode: this.statusCode,
            retryable: this.retryable,
            timestamp: this.timestamp,
            details: this.details,
            stack: this.stack
        };
    }
}

// Error factory with frontend-friendly defaults
const createError = {
    validation: (code, message, data = {}) => 
        new AppError(code, message, 400, { 
            severity: ERROR_SEVERITY.WARNING,
            action: ERROR_ACTIONS.BACK,
            ...data 
        }),
    
    authentication: (code, message, data = {}) => 
        new AppError(code, message, 401, {
            severity: ERROR_SEVERITY.ERROR,
            action: ERROR_ACTIONS.REAUTH,
            ...data
        }),
    
    authorization: (code, message, data = {}) => 
        new AppError(code, message, 403, {
            severity: ERROR_SEVERITY.ERROR,
            action: ERROR_ACTIONS.BACK,
            ...data
        }),
    
    notFound: (code, message, data = {}) => 
        new AppError(code, message, 404, {
            severity: ERROR_SEVERITY.WARNING,
            action: ERROR_ACTIONS.BACK,
            ...data
        }),
    
    rateLimit: (code, message, data = {}) => 
        new AppError(code, message, 429, {
            severity: ERROR_SEVERITY.WARNING,
            action: ERROR_ACTIONS.RETRY,
            retryable: true,
            ...data
        }),
    
    business: (code, message, data = {}) => 
        new AppError(code, message, 422, {
            severity: ERROR_SEVERITY.WARNING,
            ...data
        }),
    
    service: (code, message, data = {}) => 
        new AppError(code, message, 500, {
            severity: ERROR_SEVERITY.CRITICAL,
            action: ERROR_ACTIONS.RELOAD,
            ...data
        })
};

module.exports = {
    ERROR_CODES,
    ERROR_CATEGORIES,
    ERROR_SEVERITY,
    ERROR_ACTIONS,
    AppError,
    createError
}; 