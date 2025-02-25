const { WS_EVENTS, PASS_EVENTS } = require('../utils/constants.cjs');
const logger = require('../utils/logger.cjs');

/**
 * Initialize pass-related socket handlers
 * @param {Object} io - Socket.io instance
 */
const initializePassHandlers = (io) => {
    // Handle venue room management
    io.on(WS_EVENTS.CONNECT, (socket) => {
        // Join venue room
        socket.on(WS_EVENTS.JOIN_VENUE, (venueId) => {
            if (!venueId) return;
            socket.join(`venue_${venueId}`);
            logger.info(`Client joined venue room: ${venueId}`);
        });

        // Leave venue room
        socket.on(WS_EVENTS.LEAVE_VENUE, (venueId) => {
            if (!venueId) return;
            socket.leave(`venue_${venueId}`);
            logger.info(`Client left venue room: ${venueId}`);
        });

        // Handle disconnection
        socket.on(WS_EVENTS.DISCONNECT, () => {
            logger.info('Client disconnected from pass updates');
        });
    });
};

/**
 * Emit pass usage event to relevant venue room
 * @param {Object} io - Socket.io instance
 * @param {Object} pass - Pass object that was used
 */
const emitPassUsed = (io, pass) => {
    try {
        if (!pass || !pass.venueId) return;

        const roomName = `venue_${pass.venueId}`;
        io.to(roomName).emit(WS_EVENTS.PASS_USED, {
            passId: pass._id,
            type: pass.type,
            usedAt: new Date(),
            deviceId: pass.deviceId
        });

        logger.info(`Emitted pass used event to room: ${roomName}`);
    } catch (error) {
        logger.error('Error emitting pass used event:', error);
    }
};

/**
 * Emit pass update event to relevant venue room
 * @param {Object} io - Socket.io instance
 * @param {Object} pass - Updated pass object
 */
const emitPassUpdated = (io, pass) => {
    try {
        if (!pass || !pass.venueId) return;

        const roomName = `venue_${pass.venueId}`;
        io.to(roomName).emit(WS_EVENTS.PASS_UPDATED, {
            passId: pass._id,
            type: pass.type,
            status: pass.status,
            updatedAt: new Date()
        });

        logger.info(`Emitted pass updated event to room: ${roomName}`);
    } catch (error) {
        logger.error('Error emitting pass updated event:', error);
    }
};

module.exports = {
    initializePassHandlers,
    emitPassUsed,
    emitPassUpdated
}; 