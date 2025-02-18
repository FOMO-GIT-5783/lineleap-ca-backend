/* eslint-env jest */

const socketIo = require('socket.io');
const logger = require('./logger.cjs');
const { venueEvents } = require('./venueEvents.cjs');
const wsMonitor = require('./websocketMonitor.cjs');
const { wsConfig } = require('../config/cors.cjs');

let io;

async function initialize(server) {
    try {
        logger.info('Initializing Socket.IO...');

        // Wait for WebSocket monitor to be ready
        if (!wsMonitor.isReady()) {
            logger.warn('WebSocket monitor not ready, waiting...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!wsMonitor.isReady()) {
                throw new Error('WebSocket monitor failed to initialize');
            }
        }
        
        io = socketIo(server, wsConfig);
        
        io.on('connection', async (socket) => {
            logger.info(`Socket connected: ${socket.id}`);
            
            socket.on('joinVenue', async (venueId) => {
                try {
                    const room = `venue:${venueId}`;
                    await socket.join(room);
                    logger.info(`Socket ${socket.id} joined ${room}`);
                    
                    // Track connection in WebSocket monitor
                    await wsMonitor.trackConnection(venueId, socket.id);
                    
                    // Emit metrics update
                    venueEvents.emitMetricsUpdated(venueId, {
                        connections: io.sockets.adapter.rooms.get(room)?.size || 0,
                        timestamp: Date.now()
                    });
                } catch (error) {
                    logger.error('Error in joinVenue:', {
                        error: error.message,
                        socketId: socket.id,
                        venueId
                    });
                }
            });

            socket.on('message', async (venueId, message) => {
                try {
                    await wsMonitor.updateVenueActivity(venueId, socket.id);
                    venueEvents.emitMessageProcessed(venueId, message);
                } catch (error) {
                    logger.error('Error processing message:', {
                        error: error.message,
                        socketId: socket.id,
                        venueId
                    });
                }
            });
            
            socket.on('disconnect', async () => {
                try {
                    logger.info(`Socket disconnected: ${socket.id}`);
                    
                    // Update metrics for all venues this socket was in
                    const rooms = Array.from(socket.rooms)
                        .filter(room => room.startsWith('venue:'))
                        .map(room => {
                            const venueId = room.replace('venue:', '');
                            wsMonitor.untrackConnection(venueId, socket.id);
                            venueEvents.emitMetricsUpdated(venueId, {
                                connections: io.sockets.adapter.rooms.get(room)?.size || 0,
                                timestamp: Date.now()
                            });
                            return venueId;
                        });
                } catch (error) {
                    logger.error('Error in disconnect:', {
                        error: error.message,
                        socketId: socket.id
                    });
                }
            });
            
            socket.on('error', (error) => {
                logger.error('Socket error:', {
                    error: error.message,
                    socketId: socket.id
                });
            });
        });
        
        logger.info('Socket.IO initialized successfully');
        return io;
    } catch (error) {
        logger.error('Failed to initialize Socket.IO:', error);
        throw error;
    }
}

function getIO() {
    if (!io) {
        if (process.env.NODE_ENV === 'test') {
            logger.debug('Returning mock Socket.IO instance for test environment');
            return {
                to: () => ({ emit: () => {} }),
                emit: () => {}
            };
        }
        logger.error('Socket.IO not initialized');
        throw new Error('Socket.IO not initialized');
    }
    return io;
}

module.exports = {
    initialize,
    getIO
}; 