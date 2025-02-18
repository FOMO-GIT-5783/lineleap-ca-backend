const logger = require('./logger.cjs');
const BaseService = require('./baseService.cjs');
const zlib = require('zlib');
const { promisify } = require('util');
const { withWebSocketBoundary, createError, ERROR_CODES } = require('./errors.cjs');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Maintain singleton for backward compatibility
let instance = null;

class WebSocketEnhancer extends BaseService {
    constructor(config = {}) {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('websocket-enhancer', {}, config);

        // Initialize instance variables
        this.compressionStates = null;
        this.isCompressionEnabled = () => process.env.ENABLE_WS_COMPRESSION === 'true';

        instance = this;
    }

    /**
     * Factory method for service container
     */
    static async create(config = {}) {
        // Return existing instance if available
        if (instance) {
            return instance;
        }

        const service = new WebSocketEnhancer(config);
        await service.initialize();
        return service;
    }

    /**
     * Internal initialization
     */
    async _init() {
        const cache = this.getDependency('cache');

        // Initialize compression states cache
        this.compressionStates = cache.getCache('GENERAL');

        logger.info('WebSocket enhancer initialized');
    }

    async #determineCompressionLevel(metrics) {
        if (metrics.connections <= 25) return 0;
        if (metrics.connections <= 50) return 1;
        return 2;
    }

    async enhanceSocket(socket, venueId) {
        return withWebSocketBoundary(async () => {
            if (!this.isReady()) {
                throw createError.websocket(
                    ERROR_CODES.SERVICE_NOT_READY,
                    'WebSocket enhancer not ready',
                    { venueId, socketId: socket.id }
                );
            }

            // Create base socket first
            const enhancedSocket = {
                ...socket,
                venueId,
                compressionEnabled: false,
                compressionLevel: 0
            };

            // Early return if compression disabled
            if (!this.isCompressionEnabled()) {
                // Add basic emit without compression
                enhancedSocket.emit = async (...args) => socket.emit.apply(socket, args);
                this.#setupMonitoring(enhancedSocket);
                return enhancedSocket;
            }

            // Add compression-aware emit
            enhancedSocket.emit = async (...args) => {
                return withWebSocketBoundary(async () => {
                    const [event, data, ...rest] = args;
                    const enhanced = await this.#processOutgoingMessage(enhancedSocket, event, data);
                    return socket.emit.call(socket, event, enhanced, ...rest);
                }, {
                    venueId,
                    socketId: socket.id,
                    event: args[0],
                    source: 'socket.emit'
                });
            };

            // Set up monitoring
            this.#setupMonitoring(enhancedSocket);

            try {
                const wsMonitor = this.getDependency('websocket-monitor');
                const optimization = this.getDependency('optimization');

                // Get metrics and optimization settings
                const [metrics, settings] = await Promise.all([
                    wsMonitor.getVenueMetrics(venueId),
                    optimization.getOptimizations(venueId)
                ]);

                // Only enable if both conditions met
                if (settings?.compressionEnabled && metrics.connections > 25) {
                    const level = await this.#determineCompressionLevel(metrics);
                    if (level > 0) {
                        enhancedSocket.compressionEnabled = true;
                        enhancedSocket.compressionLevel = level;

                        await wsMonitor.recordMetric('ws_compression_applied', {
                            venueId,
                            level,
                            socketId: socket.id
                        });
                    }
                }
            } catch (error) {
                // Log but don't fail socket enhancement
                logger.error('Failed to initialize compression:', {
                    error: error.message,
                    venueId,
                    socketId: socket.id
                });
            }

            return enhancedSocket;
        }, {
            venueId,
            socketId: socket.id,
            source: 'enhanceSocket'
        });
    }

    async #processOutgoingMessage(socket, event, data) {
        return withWebSocketBoundary(async () => {
            if (!data || Buffer.byteLength(JSON.stringify(data)) < 1024) {
                return data;
            }

            if (socket.compressionEnabled) {
                const compressed = await gzip(JSON.stringify(data));
                return { compressed: true, data: compressed };
            }

            return data;
        }, {
            venueId: socket.venueId,
            socketId: socket.id,
            event,
            source: 'processOutgoingMessage'
        });
    }

    #setupMonitoring(socket) {
        const messageStats = {
            sent: { count: 0, bytes: 0 },
            compressed: { count: 0, bytes: 0, savedBytes: 0 }
        };

        socket.on('message', async (data) => {
            return withWebSocketBoundary(async () => {
                const size = Buffer.byteLength(JSON.stringify(data));
                messageStats.sent.count++;
                messageStats.sent.bytes += size;

                if (socket.compressionEnabled) {
                    messageStats.compressed.count++;
                    messageStats.compressed.bytes += size;
                }

                if (messageStats.sent.count % 100 === 0) {
                    const wsMonitor = this.getDependency('websocket-monitor');
                    await wsMonitor.recordMetric('ws_messages', {
                        venueId: socket.venueId,
                        total: messageStats.sent,
                        compressed: messageStats.compressed
                    });
                }
            }, {
                venueId: socket.venueId,
                socketId: socket.id,
                messageSize: size,
                source: 'message'
            });
        });

        socket.on('error', async (error) => {
            const wsMonitor = this.getDependency('websocket-monitor');
            const wsError = createError.websocket(
                ERROR_CODES.WEBSOCKET_ERROR,
                error.message,
                {
                    venueId: socket.venueId,
                    socketId: socket.id,
                    compressionEnabled: socket.compressionEnabled,
                    compressionLevel: socket.compressionLevel,
                    source: 'socket.error'
                }
            );

            logger.error('Socket error:', wsError.getLogContext());
            await wsMonitor.recordMetric('ws_error', wsError.getLogContext());
        });
    }

    /**
     * Cleanup resources
     */
    async _cleanup() {
        if (this.compressionStates) {
            this.compressionStates.clear();
        }
        logger.info('WebSocket enhancer cleaned up');
    }

    /**
     * Check if service is ready
     */
    isReady() {
        return this.state === 'ready' && this.compressionStates !== null;
    }

    /**
     * Get service health
     */
    getHealth() {
        return {
            ...super.getHealth(),
            compressionEnabled: this.isCompressionEnabled(),
            activeCompressionStates: this.compressionStates?.size || 0
        };
    }
}

// Export singleton instance for backward compatibility
module.exports = new WebSocketEnhancer();
// Also export the class for service container
module.exports.WebSocketEnhancer = WebSocketEnhancer; 