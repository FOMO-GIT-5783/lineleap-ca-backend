// Event type constants for the entire system
const EVENT_TYPES = {
    // Venue Events
    VENUE: {
        UPDATED: 'venue:updated',
        STATE_CHANGED: 'venue:state_changed',
        METRICS_UPDATED: 'venue:metrics_updated',
        OPTIMIZATION_NEEDED: 'venue:optimization_needed',
        OPTIMIZATION_APPLIED: 'venue:optimization_applied',
        CLIENT_JOINED: 'venue:client_joined',
        CLIENT_LEFT: 'venue:client_left',
        DASHBOARD_UPDATE: 'venue:dashboard_update',
        OWNER_STATS_UPDATE: 'venue:owner_stats_update'
    },

    // Auth Events
    AUTH: {
        SESSION_CREATED: 'auth:session_created',
        SESSION_UPDATED: 'auth:session_updated',
        SESSION_EXPIRED: 'auth:session_expired',
        TOKEN_REFRESHED: 'auth:token_refreshed',
        LOGIN_FAILED: 'auth:login_failed',
        TOKEN_GENERATED: 'auth:token:generated',
        TOKEN_VERIFIED: 'auth:token:verified',
        TOKEN_EXPIRED: 'auth:token:expired',
        TOKEN_REVOKED: 'auth:token:revoked',
        METRICS_UPDATED: 'auth:metrics:updated',
        SECURITY_ALERT: 'auth:security:alert',
        RATE_LIMIT_HIT: 'auth:ratelimit:hit',
        SUSPICIOUS_ACTIVITY: 'auth:security:suspicious'
    },

    // Payment Events
    PAYMENT: {
        INITIATED: 'payment.initiated',
        COMPLETED: 'payment.completed',
        FAILED: 'payment.failed',
        ROLLBACK: 'payment.rollback',
        STATUS_UPDATED: 'payment.status.updated'
    },

    // WebSocket Events
    SOCKET: {
        CONNECTION: 'socket:connection',
        DISCONNECTION: 'socket:disconnection',
        ERROR: 'socket:error',
        MESSAGE: 'socket:message'
    },

    // Optimization Events
    OPTIMIZATION: {
        THRESHOLD_REACHED: 'optimization:threshold_reached',
        APPLIED: 'optimization:applied',
        METRICS_UPDATED: 'optimization:metrics_updated'
    },

    // Order Events
    ORDER: {
        CREATED: 'order.created',
        UPDATED: 'order.updated',
        COMPLETED: 'order.completed',
        FAILED: 'order.failed',
        CANCELLED: 'order.cancelled'
    },

    // Feature Events
    FEATURE: {
        STATE_CHANGED: 'feature.state.changed',
        OVERRIDE_SET: 'feature.override.set'
    },

    // Lock Events
    LOCK: {
        ACQUIRED: 'lock.acquired',
        RELEASED: 'lock.released',
        EXPIRED: 'lock.expired'
    },

    // Metrics Events
    METRICS: {
        PAYMENT_LATENCY: 'metrics.payment.latency',
        PAYMENT_ERROR: 'metrics.payment.error',
        LOCK_TIMEOUT: 'metrics.lock.timeout',
        CIRCUIT_BREAKER: 'metrics.circuit.breaker',
        AUTH_LATENCY: 'metrics.auth.latency',
        AUTH_ERROR: 'metrics.auth.error',
        TOKEN_METRICS: 'metrics.auth.token',
        SESSION_METRICS: 'metrics.auth.session'
    }
};

// WebSocket Events (Source: WebSocketMonitor)
const SOCKET_EVENTS = {
    CONNECTION: 'socket:connection',
    DISCONNECTION: 'socket:disconnection',
    MESSAGE: 'socket:message',
    METRICS_UPDATED: 'socket:metrics:updated'
};

// Optimization Events (Source: OptimizationManager)
const OPTIMIZATION_EVENTS = {
    APPLIED: 'optimization:applied',
    REVERTED: 'optimization:reverted',
    CONFIG_UPDATED: 'optimization:config:updated'
};

// Metrics Events (Source: WebSocketMonitor)
const METRICS_EVENTS = {
    THRESHOLD_REACHED: 'metrics:threshold:reached',
    THRESHOLD_CLEARED: 'metrics:threshold:cleared',
    VENUE_STATS_UPDATED: 'metrics:venue:updated'
};

module.exports = {
    EVENT_TYPES,
    SOCKET_EVENTS,
    OPTIMIZATION_EVENTS,
    METRICS_EVENTS
}; 