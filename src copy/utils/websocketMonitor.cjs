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
        this.venueStates = new Map();
        this.config = HALIFAX_WS_CONFIG;
        this.logger = logger.child({
            context: 'websocket',
            service: 'monitor'
        });
    }

    async _init() {
        // Start periodic health checks
        this.healthCheckInterval = setInterval(() => {
            this.runHealthChecks();
        }, 30000); // Every 30 seconds

        this.logger.info('WebSocket monitor initialized', {
            config: this.config
        });
    }

    async trackConnection(venueId, socketId) {
        try {
            const venueMetrics = this.getVenueMetrics(venueId);
            venueMetrics.connections++;
            venueMetrics.lastConnection = Date.now();
            venueMetrics.sockets.add(socketId);

            this.metrics.set(venueId, venueMetrics);
            await this.checkVenueHealth(venueId);

            this.logger.debug('Connection tracked', {
                venueId,
                socketId,
                connections: venueMetrics.connections
            });
        } catch (error) {
            this.logger.error('Error tracking connection:', {
                error: error.message,
                venueId,
                socketId
            });
        }
    }

    async untrackConnection(venueId, socketId) {
        try {
            const venueMetrics = this.getVenueMetrics(venueId);
            venueMetrics.connections = Math.max(0, venueMetrics.connections - 1);
            venueMetrics.sockets.delete(socketId);
            venueMetrics.lastDisconnection = Date.now();

            this.metrics.set(venueId, venueMetrics);
            await this.checkVenueHealth(venueId);

            this.logger.debug('Connection untracked', {
                venueId,
                socketId,
                connections: venueMetrics.connections
            });
        } catch (error) {
            this.logger.error('Error untracking connection:', {
                error: error.message,
                venueId,
                socketId
            });
        }
    }

    getVenueMetrics(venueId) {
        return this.metrics.get(venueId) || {
            connections: 0,
            messageRate: 0,
            errors: 0,
            latency: [],
            sockets: new Set(),
            lastConnection: null,
            lastDisconnection: null,
            lastError: null,
            state: 'normal'
        };
    }

    async checkVenueHealth(venueId) {
        const metrics = this.getVenueMetrics(venueId);
        const prevState = metrics.state;
        
        // Determine health state
        if (metrics.connections > this.config.thresholds.critical) {
            metrics.state = 'critical';
        } else if (metrics.connections > this.config.thresholds.warning) {
            metrics.state = 'warning';
        } else {
            metrics.state = 'normal';
        }

        // Log state changes
        if (prevState !== metrics.state) {
            this.logger.info('Venue health state changed', {
                venueId,
                prevState,
                newState: metrics.state,
                connections: metrics.connections
            });

            // Emit state change event
            const events = this.getDependency('events');
            if (events) {
                events.emit('websocket:state_changed', {
                    venueId,
                    prevState,
                    newState: metrics.state,
                    metrics
                });
            }
        }

        return metrics.state;
    }

    async runHealthChecks() {
        try {
            const unhealthyVenues = [];
            
            for (const [venueId, metrics] of this.metrics.entries()) {
                // Check for stale connections
                const now = Date.now();
                if (metrics.lastConnection && 
                    now - metrics.lastConnection > 5 * 60 * 1000 && // 5 minutes
                    metrics.connections > 0) {
                    this.logger.warn('Stale connections detected', {
                        venueId,
                        connections: metrics.connections,
                        lastConnection: new Date(metrics.lastConnection)
                    });
                    unhealthyVenues.push(venueId);
                }

                // Check error rate
                if (metrics.errors > 10) { // More than 10 errors
                    this.logger.warn('High error rate detected', {
                        venueId,
                        errors: metrics.errors
                    });
                    unhealthyVenues.push(venueId);
                }

                // Check latency
                if (metrics.latency.length > 0) {
                    const avgLatency = metrics.latency.reduce((a, b) => a + b, 0) / metrics.latency.length;
                    if (avgLatency > 1000) { // More than 1 second
                        this.logger.warn('High latency detected', {
                            venueId,
                            avgLatency
                        });
                        unhealthyVenues.push(venueId);
                    }
                }
            }

            if (unhealthyVenues.length > 0) {
                this.logger.error('Unhealthy venues detected', {
                    venues: unhealthyVenues,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            this.logger.error('Health check failed:', error);
        }
    }

    async getDetailedHealth() {
        const venueMetrics = {};
        let totalConnections = 0;
        let totalErrors = 0;

        for (const [venueId, metrics] of this.metrics.entries()) {
            totalConnections += metrics.connections;
            totalErrors += metrics.errors;

            venueMetrics[venueId] = {
                connections: metrics.connections,
                state: metrics.state,
                errors: metrics.errors,
                lastConnection: metrics.lastConnection,
                lastError: metrics.lastError
            };
        }

        return {
            status: totalErrors > 50 ? 'unhealthy' : 
                    totalErrors > 10 ? 'degraded' : 'healthy',
            timestamp: new Date().toISOString(),
            totalConnections,
            totalErrors,
            venues: venueMetrics
        };
    }

    async _cleanup() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        this.metrics.clear();
        this.venueStates.clear();
        this.logger.info('WebSocket monitor cleaned up');
    }

    getHealth() {
        const totalConnections = Array.from(this.metrics.values())
            .reduce((sum, m) => sum + m.connections, 0);
        
        const totalErrors = Array.from(this.metrics.values())
            .reduce((sum, m) => sum + m.errors, 0);

        return {
            status: totalErrors > 50 ? 'unhealthy' : 
                    totalErrors > 10 ? 'degraded' : 'healthy',
            activeVenues: this.metrics.size,
            totalConnections,
            totalErrors,
            config: {
                thresholds: this.config.thresholds,
                healthCheckInterval: 30000
            }
        };
    }
}

// Export singleton instance for backward compatibility
module.exports = new WebSocketMonitor();
// Also export the class for service container
module.exports.WebSocketMonitor = WebSocketMonitor;