const BaseService = require('./baseService.cjs');
const logger = require('./logger.cjs');
const { SOCKET_EVENTS, METRICS_EVENTS } = require('./eventTypes.cjs');
const { HALIFAX_WS_CONFIG } = require('../config/websocket.cjs');

// Maintain singleton for backward compatibility
let instance = null;

class VenueMonitor extends BaseService {
    constructor(config = {}) {
        super('venue-monitor', {}, config);
        this.metrics = new Map();
        this.logger = logger.child({
            context: 'venue-monitor',
            service: 'venue-monitor'
        });
    }

    async _init() {
        const events = this.getDependency('events');
        if (events) {
            events.safeOn(EVENT_TYPES.SOCKET.CONNECTION, this.recordConnection.bind(this));
            events.safeOn(EVENT_TYPES.SOCKET.MESSAGE, this.recordMessage.bind(this));
        }
        this.logger.info('Venue monitor initialized');
    }

    async recordConnection(socket, venueId) {
        if (!this.metrics.has(venueId)) {
            this.metrics.set(venueId, new Map());
        }
        const venueMetrics = this.metrics.get(venueId);
        venueMetrics.set('connections', (venueMetrics.get('connections') || 0) + 1);
        
        this.logger.info('Connection recorded', {
            venueId,
            socketId: socket.id,
            totalConnections: venueMetrics.get('connections')
        });
    }

    async recordMessage(data) {
        const { venueId, message } = data;
        if (!this.metrics.has(venueId)) {
            this.metrics.set(venueId, new Map());
        }
        const venueMetrics = this.metrics.get(venueId);
        venueMetrics.set('messages', (venueMetrics.get('messages') || 0) + 1);
        
        this.logger.debug('Message recorded', {
            venueId,
            messageType: message.type,
            totalMessages: venueMetrics.get('messages')
        });
    }

    async getVenueMetrics(venueId) {
        return this.metrics.get(venueId) || {};
    }

    isReady() {
        return this.state === 'ready';
    }
}

class OptimizationAdvisor extends BaseService {
    constructor(config = {}) {
        super('optimization-advisor', {}, config);
        this.thresholds = config.thresholds || {
            normal: 30,
            warning: 50,
            critical: 75
        };
        this.optimizations = new Map();
        this.logger = logger.child({
            context: 'optimization-advisor',
            service: 'optimization-advisor'
        });
    }

    async _init() {
        const events = this.getDependency('events');
        if (events) {
            events.safeOn(EVENT_TYPES.VENUE.METRICS_UPDATED, this.evaluateOptimizations.bind(this));
        }
        this.logger.info('Optimization advisor initialized', {
            thresholds: this.thresholds
        });
    }

    async shouldOptimize(metrics) {
        return metrics.connections > this.thresholds.warning;
    }

    async determineCompressionLevel(metrics) {
        if (metrics.connections > this.thresholds.critical) return 2;
        if (metrics.connections > this.thresholds.warning) return 1;
        return 0;
    }

    getOptimizations(venueId) {
        return this.optimizations.get(venueId) || {
            compression: false,
            batching: false,
            level: 0
        };
    }

    getOptimizedVenues() {
        return Array.from(this.optimizations.entries())
            .filter(([_, opts]) => opts.compression || opts.batching)
            .length;
    }

    async evaluateOptimizations({ venueId, metrics }) {
        const level = await this.determineCompressionLevel(metrics);
        const shouldOptimize = await this.shouldOptimize(metrics);

        this.optimizations.set(venueId, {
            compression: level > 0,
            batching: shouldOptimize,
            level
        });

        this.logger.info('Optimizations evaluated', {
            venueId,
            metrics,
            optimizations: this.getOptimizations(venueId)
        });

        // Notify event system
        const events = this.getDependency('events');
        if (events) {
            events.emitOptimizationEvent('APPLIED', {
                venueId,
                optimizations: this.getOptimizations(venueId)
            });
        }
    }

    async _cleanup() {
        this.optimizations.clear();
        this.logger.info('Optimization advisor cleaned up');
    }

    isReady() {
        return this.state === 'ready';
    }
}

class ConnectionManager extends BaseService {
    constructor(config = {}) {
        super('connection-manager', {}, config);
        this.connections = new Map();
        this.logger = logger.child({
            context: 'connection-manager',
            service: 'connection-manager'
        });
    }

    async _init() {
        const events = this.getDependency('events');
        if (events) {
            events.safeOn(EVENT_TYPES.SOCKET.CONNECTION, this.handleConnection.bind(this));
            events.safeOn(EVENT_TYPES.SOCKET.DISCONNECTION, this.handleDisconnection.bind(this));
        }
        this.logger.info('Connection manager initialized');
    }

    async handleConnection(socket, venueId) {
        if (!this.connections.has(venueId)) {
            this.connections.set(venueId, new Set());
        }
        this.connections.get(venueId).add(socket.id);
        
        this.logger.info('Socket connected', {
            venueId,
            socketId: socket.id,
            totalConnections: this.getConnections(venueId)
        });
    }

    async handleDisconnection(socket, venueId) {
        const venueConnections = this.connections.get(venueId);
        if (venueConnections) {
            venueConnections.delete(socket.id);
            if (venueConnections.size === 0) {
                this.connections.delete(venueId);
            }
            
            this.logger.info('Socket disconnected', {
                venueId,
                socketId: socket.id,
                remainingConnections: this.getConnections(venueId)
            });
        }
    }

    getConnections(venueId) {
        const venueConnections = this.connections.get(venueId);
        return venueConnections ? venueConnections.size : 0;
    }

    getTotalConnections() {
        let total = 0;
        for (const connections of this.connections.values()) {
            total += connections.size;
        }
        return total;
    }

    getActiveVenues() {
        return this.connections.size;
    }

    async _cleanup() {
        this.connections.clear();
        this.logger.info('Connection manager cleaned up');
    }

    isReady() {
        return this.state === 'ready';
    }
}

// Main WebSocket monitor service
class WebSocketMonitor extends BaseService {
    constructor() {
        super('websocket-monitor');
        this.metrics = new Map();
        this.connections = new Map();
        this.venueConnections = new Map();
        this.venueSessions = new Map();
        this.logger = logger.child({
            service: 'websocket-monitor'
        });
    }

    async _init() {
        const events = this.getDependency('events');
        if (!events) {
            throw new Error('Events system required for WebSocket monitor');
        }

        // Initialize metrics
        this.lastUpdate = Date.now();
        this.totalConnections = 0;
        this.venueConnections = new Map();

        this.logger.info('WebSocket monitor initialized');
    }

    getHealth() {
        const isDevelopment = process.env.NODE_ENV === 'development';
        const now = Date.now();
        const lastUpdateAge = now - (this.lastUpdate || now);
        const staleThreshold = 60000; // 1 minute
        const isStale = lastUpdateAge > staleThreshold;

        // In development, we're always healthy unless explicitly marked unhealthy
        const status = isDevelopment ? 'healthy' : (isStale ? 'unhealthy' : 'healthy');

        const health = {
            status,
            totalConnections: this.totalConnections || 0,
            activeVenueSessions: this.venueSessions?.size || 0,
            metrics: {
                connections: {
                    total: this.totalConnections || 0,
                    byVenue: Array.from(this.venueConnections || new Map()).map(([venue, count]) => ({
                        venue,
                        count
                    }))
                },
                messageRates: Array.from(this.metrics || new Map()).map(([venue, rate]) => ({
                    venue,
                    rate
                }))
            }
        };

        // Add development-specific information
        if (isDevelopment) {
            health.mode = 'development';
            health.mockEnabled = true;
            health.staleTime = lastUpdateAge;
            health.staleThreshold = staleThreshold;
        }

        return health;
    }

    getTotalConnections() {
        return this.totalConnections;
    }

    getVenueConnections(venueId) {
        return this.venueConnections.get(venueId) || 0;
    }

    async trackConnection(venueId, socketId) {
        this.totalConnections++;
        const venueCount = (this.venueConnections.get(venueId) || 0) + 1;
        this.venueConnections.set(venueId, venueCount);

        this.logger.debug('Connection tracked', {
            venueId,
            socketId,
            totalConnections: this.totalConnections,
            venueConnections: venueCount
        });

        return {
            totalConnections: this.totalConnections,
            venueConnections: venueCount
        };
    }

    async untrackConnection(venueId, socketId) {
        if (this.totalConnections > 0) {
            this.totalConnections--;
        }

        const venueCount = Math.max(0, (this.venueConnections.get(venueId) || 1) - 1);
        this.venueConnections.set(venueId, venueCount);

        this.logger.debug('Connection untracked', {
            venueId,
            socketId,
            totalConnections: this.totalConnections,
            venueConnections: venueCount
        });

        return {
            totalConnections: this.totalConnections,
            venueConnections: venueCount
        };
    }

    async trackVenueSession(venueId, userId, socketId) {
        if (!this.venueSessions.has(venueId)) {
            this.venueSessions.set(venueId, new Map());
        }
        const venueSessions = this.venueSessions.get(venueId);
        venueSessions.set(userId, {
            socketId,
            connectedAt: Date.now(),
            lastActivity: Date.now()
        });

        this.logger.info('Venue session tracked', {
            venueId,
            userId,
            socketId,
            activeSessions: venueSessions.size
        });

        return this.getVenueSessionMetrics(venueId);
    }

    async updateVenueActivity(venueId, userId) {
        const venueSessions = this.venueSessions.get(venueId);
        if (venueSessions?.has(userId)) {
            const session = venueSessions.get(userId);
            session.lastActivity = Date.now();
            venueSessions.set(userId, session);
        }
    }

    getVenueSessionMetrics(venueId) {
        const venueSessions = this.venueSessions.get(venueId);
        if (!venueSessions) return null;

        const now = Date.now();
        const sessions = Array.from(venueSessions.entries());
        
        return {
            totalSessions: venueSessions.size,
            activeSessions: sessions.filter(([_, s]) => now - s.lastActivity < 300000).length,
            oldestSession: Math.min(...sessions.map(([_, s]) => s.connectedAt)),
            averageSessionAge: sessions.reduce((sum, [_, s]) => sum + (now - s.connectedAt), 0) / sessions.length
        };
    }

    async _cleanup() {
        this.metrics.clear();
        this.connections.clear();
        this.venueConnections.clear();
        this.venueSessions.clear();
        this.totalConnections = 0;
        this.logger.info('WebSocket monitor cleaned up');
    }
}

// Export singleton instance for backward compatibility
module.exports = new WebSocketMonitor();
// Also export the class for service container
module.exports.WebSocketMonitor = WebSocketMonitor;