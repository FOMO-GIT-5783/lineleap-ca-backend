const eventBus = require('./eventBus.cjs');

const AUTH_EVENTS = {
    SESSION_CREATED: 'auth:session_created',
    SESSION_UPDATED: 'auth:session_updated',
    SESSION_EXPIRED: 'auth:session_expired',
    TOKEN_REFRESHED: 'auth:token_refreshed',
    LOGIN_FAILED: 'auth:login_failed',
    RATE_LIMIT_EXCEEDED: 'auth:rate_limit_exceeded',
    IP_BLOCKED: 'auth:ip_blocked'
};

const authEvents = {
    emitSessionCreated(userId, sessionData) {
        eventBus.emit(AUTH_EVENTS.SESSION_CREATED, { userId, ...sessionData });
    },

    emitSessionUpdated(userId, sessionData) {
        eventBus.emit(AUTH_EVENTS.SESSION_UPDATED, { userId, ...sessionData });
    },

    emitSessionExpired(userId, token) {
        eventBus.emit(AUTH_EVENTS.SESSION_EXPIRED, { userId, token });
    },

    emitTokenRefreshed(userId, tokens) {
        eventBus.emit(AUTH_EVENTS.TOKEN_REFRESHED, { userId, ...tokens });
    },

    emitLoginFailed(ip, reason) {
        eventBus.emit(AUTH_EVENTS.LOGIN_FAILED, { ip, reason });
    },

    emitRateLimitExceeded(ip, type) {
        eventBus.emit(AUTH_EVENTS.RATE_LIMIT_EXCEEDED, { ip, type });
    },

    emitIPBlocked(ip, reason) {
        eventBus.emit(AUTH_EVENTS.IP_BLOCKED, { ip, reason });
    },

    // Event handlers
    onSessionCreated(handler) {
        eventBus.on(AUTH_EVENTS.SESSION_CREATED, handler);
    },

    onSessionUpdated(handler) {
        eventBus.on(AUTH_EVENTS.SESSION_UPDATED, handler);
    },

    onSessionExpired(handler) {
        eventBus.on(AUTH_EVENTS.SESSION_EXPIRED, handler);
    },

    onTokenRefreshed(handler) {
        eventBus.on(AUTH_EVENTS.TOKEN_REFRESHED, handler);
    },

    onLoginFailed(handler) {
        eventBus.on(AUTH_EVENTS.LOGIN_FAILED, handler);
    },

    onRateLimitExceeded(handler) {
        eventBus.on(AUTH_EVENTS.RATE_LIMIT_EXCEEDED, handler);
    },

    onIPBlocked(handler) {
        eventBus.on(AUTH_EVENTS.IP_BLOCKED, handler);
    }
};

module.exports = {
    AUTH_EVENTS,
    authEvents
}; 