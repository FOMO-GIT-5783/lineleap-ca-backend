const Venue = require('../models/Venue.cjs');
const { getIO } = require('../utils/io.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const { generateSocialProof } = require('../utils/socialUtils.cjs');
const OrderMetricsService = require('../services/orderMetricsService.cjs');
const Pass = require('../models/Pass.cjs');
const { getUserFromSocket, isStaffMember } = require('../utils/authUtils.cjs');
const { ORDER_EVENTS, PASS_EVENTS } = require('../utils/constants.cjs');
const { venueEvents } = require('../utils/venueEvents.cjs');
const logger = require('../utils/logger.cjs');
const eventService = require('../utils/eventEmitter.cjs');
const EVENT_TYPES = require('../utils/eventTypes.cjs');

let io;
let reconnectAttempts = new Map(); // Track reconnection attempts

// Store active connections
const connectedClients = new Map();
const venueSubscriptions = new Map();
const ownerSubscriptions = new Map();
const userPresence = new Map();

// Add reconnection configuration
const RECONNECT_CONFIG = {
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 5000
};

// Set up event listeners
function setupEventListeners() {
    // Listen for venue events
    eventService.safeOn(EVENT_TYPES.VENUE.UPDATED, ({ venueId, ...data }) => {
        io.to(`venue:${venueId}`).emit('venueUpdate', data);
    });

    eventService.safeOn(EVENT_TYPES.VENUE.DASHBOARD_UPDATE, ({ venueId, ...data }) => {
        io.to(`dashboard:${venueId}`).emit('dashboardUpdate', data);
    });

    eventService.safeOn(EVENT_TYPES.VENUE.OWNER_STATS_UPDATE, ({ venueId, stats }) => {
        io.to(`owner:${venueId}`).emit('ownerStats', stats);
    });

    eventService.safeOn(EVENT_TYPES.OPTIMIZATION.THRESHOLD_REACHED, ({ venueId, level }) => {
        io.to(`venue:${venueId}`).emit('optimizationNeeded', { level });
    });
}

function initializeSocket(server) {
    io = getIO();
    setupEventListeners();

    io.on('connection', async (socket) => {
        try {
            const user = await getUserFromSocket(socket);
            if (!user) {
                socket.disconnect();
                return;
            }

            // Track user presence
            const presenceData = {
                socketId: socket.id,
                lastSeen: new Date()
            };
            userPresence.set(user._id.toString(), presenceData);
            
            // Join venue room for real-time updates
            socket.on('joinVenue', (venueId) => {
                try {
                    socket.join(`venue:${venueId}`);
                    logger.info(`User ${user._id} joined venue ${venueId}`);
                    
                    eventService.emitVenueEvent('CLIENT_JOINED', venueId, {
                        userId: user._id,
                        socketId: socket.id,
                        timestamp: new Date()
                    });
                } catch (error) {
                    logger.error('Join Venue Error:', error);
                    socket.emit('error', { message: 'Failed to join venue' });
                }
            });

            // Leave venue room
            socket.on('leaveVenue', (venueId) => {
                try {
                    socket.leave(`venue:${venueId}`);
                    logger.info(`User ${user._id} left venue ${venueId}`);
                    
                    eventService.emitVenueEvent('CLIENT_LEFT', venueId, {
                        userId: user._id,
                        socketId: socket.id,
                        timestamp: new Date()
                    });
                } catch (error) {
                    logger.error('Leave Venue Error:', error);
                    socket.emit('error', { message: 'Failed to leave venue' });
                }
            });

            // Handle disconnection
            socket.on('disconnect', () => {
                const userId = user._id.toString();
                userPresence.delete(userId);
                logger.info(`User ${userId} disconnected`);

                // Emit presence update for all subscribed venues
                Array.from(socket.rooms)
                    .filter(room => room.startsWith('venue:'))
                    .forEach(room => {
                        const venueId = room.replace('venue:', '');
                        eventService.emitVenueEvent('CLIENT_LEFT', venueId, {
                            userId,
                            socketId: socket.id,
                            timestamp: new Date()
                        });
                    });
            });

            // Handle socket errors
            socket.on('error', (error) => {
                logger.error('Socket Error:', {
                    socketId: socket.id,
                    error: error.message,
                    timestamp: new Date()
                });
                socket.emit('error', { message: 'Connection error occurred' });
            });

            // Ping/Pong Monitoring
            socket.on('ping', () => {
                try {
                    socket.emit('pong', { timestamp: Date.now() });
                } catch (err) {
                    logger.error('Ping/Pong Error:', err);
                }
            });

            // Join order room
            socket.on('joinOrderRoom', (orderId) => {
                socket.join(`order:${orderId}`);
            });

            // Join owner room
            socket.on('joinOwnerRoom', async (venueId) => {
                try {
                    socket.join(`owner:${venueId}`);
                    if (!ownerSubscriptions.has(venueId)) {
                        ownerSubscriptions.set(venueId, new Set());
                    }
                    ownerSubscriptions.get(venueId).add(socket.id);

                    // Get and emit initial stats
                    const stats = await OrderMetricsService.getVenueMetrics(venueId);
                    eventService.emitVenueEvent('OWNER_STATS_UPDATE', venueId, { stats });
                } catch (err) {
                    logger.error('Join Owner Room Error:', {
                        venueId,
                        socketId: socket.id,
                        error: err.message,
                        stack: err.stack
                    });
                    socket.emit('error', { message: 'Failed to join owner room', reason: err.message });
                }
            });

            // Leave owner room
            socket.on('leaveOwnerRoom', (venueId) => {
                try {
                    socket.leave(`owner:${venueId}`);
                    const subs = ownerSubscriptions.get(venueId);
                    if (subs) {
                        subs.delete(socket.id);
                    }
                } catch (err) {
                    logger.error('Leave Owner Room Error:', {
                        venueId,
                        socketId: socket.id,
                        error: err.message,
                        stack: err.stack
                    });
                    socket.emit('error', { message: 'Failed to leave owner room', reason: err.message });
                }
            });

            // Order status updates
            socket.on('updateOrderStatus', async (data) => {
                try {
                    const { orderId, status, bartenderId, verificationCode, venueId } = data;
                    
                    eventService.emitVenueEvent('UPDATED', venueId, {
                        type: 'orderStatus',
                        orderId,
                        status,
                        timestamp: new Date(),
                        bartenderId,
                        verificationCode
                    });

                    // Update dashboard if needed
                    if (venueId) {
                        const metrics = await OrderMetricsService.getRealTimeMetrics(venueId);
                        eventService.emitVenueEvent('DASHBOARD_UPDATE', venueId, {
                            type: 'orderStatus',
                            data: metrics
                        });
                    }
                } catch (err) {
                    logger.error('Order Status Update Error:', {
                        orderId: data.orderId,
                        error: err.message,
                        stack: err.stack
                    });
                    socket.emit('error', { message: 'Failed to update order status' });
                }
            });

            // Enhanced dashboard room handling
            socket.on('joinDashboard', async (venueId) => {
                try {
                    // Validate venue ownership
                    const venue = await Venue.findById(venueId);
                    if (!venue || venue.ownerId.toString() !== user._id.toString()) {
                        throw createError.unauthorized(
                            ERROR_CODES.UNAUTHORIZED_ACCESS,
                            'Unauthorized access to dashboard'
                        );
                    }

                    socket.join(`dashboard:${venueId}`);
                    logger.info(`Client ${socket.id} joined dashboard for venue ${venueId}`);
                    
                    // Send initial data through venue events
                    const [metrics, realtimeStats] = await Promise.all([
                        OrderMetricsService.getRealTimeMetrics(venueId),
                        OrderMetricsService.getVenueMetrics(venueId, {
                            startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
                            endDate: new Date()
                        })
                    ]);

                    eventService.emitVenueEvent('DASHBOARD_UPDATE', venueId, {
                        type: 'initial',
                        data: {
                            metrics,
                            realtimeStats,
                            lastUpdated: new Date()
                        }
                    });

                    // Set up reconnection handling
                    socket.on('disconnect', (reason) => {
                        handleDashboardDisconnect(socket, venueId, reason);
                    });
                } catch (err) {
                    logger.error('Join Dashboard Error:', err);
                    socket.emit('error', { 
                        message: 'Failed to join dashboard',
                        details: err.message
                    });
                }
            });

            socket.on('leaveDashboard', (venueId) => {
                socket.leave(`dashboard:${venueId}`);
            });

            // Add pass event handling
            handlePassEvents(socket, user);
        } catch (error) {
            logger.error('Socket Connection Error:', error);
            socket.disconnect();
        }
    });

    startDashboardUpdates();
    return io;
}

// Handle Disconnects
function handleDisconnect(socket, reason) {
    try {
        logger.info('Client disconnected:', {
            socketId: socket.id,
            reason,
            timestamp: new Date()
        });

        connectedClients.delete(socket.id);

        // Reconnection attempts
        if (reason === 'transport close') {
            const attempts = reconnectAttempts.get(socket.id) || 0;
            if (attempts < RECONNECT_CONFIG.maxAttempts) {
                reconnectAttempts.set(socket.id, attempts + 1);
            } else {
                logger.error('Max reconnection attempts reached:', socket.id);
                reconnectAttempts.delete(socket.id);
            }
        }

        // Remove from subscriptions and emit events
        for (const [venueId, subs] of venueSubscriptions.entries()) {
            if (subs.has(socket.id)) {
                subs.delete(socket.id);
                eventService.emitVenueEvent('CLIENT_LEFT', venueId, {
                    socketId: socket.id,
                    timestamp: new Date()
                });
            }
        }
    } catch (err) {
        logger.error('Disconnect Handler Error:', err);
    }
}

// Enhanced periodic updates
const startDashboardUpdates = () => {
    setInterval(async () => {
        try {
            const dashboardRooms = Array.from(io.sockets.adapter.rooms.keys())
                .filter(room => room.startsWith('dashboard:'))
                .map(room => room.split(':')[1]);

            await Promise.all(dashboardRooms.map(async (venueId) => {
                try {
                    const [metrics, peakHours] = await Promise.all([
                        OrderMetricsService.getRealTimeMetrics(venueId),
                        OrderMetricsService.calculatePeakHours(venueId)
                    ]);

                    eventService.emitVenueEvent('DASHBOARD_UPDATE', venueId, {
                        type: 'periodic',
                        data: {
                            metrics,
                            peakHours,
                            lastUpdated: new Date()
                        }
                    });
                } catch (roomError) {
                    logger.error(`Error updating dashboard for venue ${venueId}:`, roomError);
                }
            }));
        } catch (err) {
            logger.error('Dashboard Update Error:', err);
        }
    }, 30000);
};

// Handle dashboard disconnects
function handleDashboardDisconnect(socket, venueId, reason) {
    const reconnectKey = `${socket.id}:${venueId}`;
    const attempts = reconnectAttempts.get(reconnectKey) || 0;

    if (reason === 'transport close' && attempts < RECONNECT_CONFIG.maxAttempts) {
        const delay = Math.min(
            RECONNECT_CONFIG.initialDelay * Math.pow(2, attempts),
            RECONNECT_CONFIG.maxDelay
        );

        setTimeout(async () => {
            try {
                if (socket.connected) {
                    await socket.join(`dashboard:${venueId}`);
                    reconnectAttempts.delete(reconnectKey);
                    
                    // Resend initial data after reconnection
                    const realtimeMetrics = await OrderMetricsService.getRealTimeMetrics(venueId);
                    eventService.emitVenueEvent('DASHBOARD_UPDATE', venueId, {
                        type: 'reconnected',
                        data: realtimeMetrics
                    });
                } else {
                    reconnectAttempts.set(reconnectKey, attempts + 1);
                }
            } catch (err) {
                logger.error('Dashboard Reconnection Error:', err);
            }
        }, delay);
    } else {
        reconnectAttempts.delete(reconnectKey);
    }
}

// Handle pass events
function handlePassEvents(socket, user) {
    socket.on('joinPassRoom', async (venueId) => {
        try {
            const venue = await Venue.findById(venueId);
            if (!venue || !isStaffMember(user, venue)) {
                throw new Error('Unauthorized');
            }

            socket.join(`pass:${venueId}`);
            
            // Send initial active passes
            const activePasses = await Pass.findActiveForVenue(venueId);
            eventService.emitVenueEvent('UPDATED', venueId, {
                type: 'activePasses',
                passes: activePasses
            });
        } catch (error) {
            logger.error('Error joining pass room:', error);
            socket.emit('error', {
                message: 'Failed to join pass room'
            });
        }
    });

    socket.on('leavePassRoom', (venueId) => {
        socket.leave(`pass:${venueId}`);
    });
}

module.exports = {
    initializeSocket,
    userPresence,
    ORDER_EVENTS,
    PASS_EVENTS
};




