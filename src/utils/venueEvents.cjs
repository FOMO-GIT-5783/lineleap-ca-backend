const eventBus = require('./eventBus.cjs');

// Event types
const VENUE_EVENTS = {
    // State Events
    VENUE_UPDATED: 'venue:updated',
    VENUE_STATE_CHANGED: 'venue:state_changed',
    VENUE_METRICS_UPDATED: 'venue:metrics_updated',
    
    // Optimization Events
    OPTIMIZATION_NEEDED: 'venue:optimization_needed',
    OPTIMIZATION_APPLIED: 'venue:optimization_applied',
    
    // Message Events
    MESSAGE_PROCESSED: 'venue:message_processed',
    MESSAGE_BATCH_PROCESSED: 'venue:message_batch_processed',
    
    // Connection Events
    CLIENT_JOINED: 'venue:client_joined',
    CLIENT_LEFT: 'venue:client_left',
    
    // Dashboard Events
    DASHBOARD_UPDATE: 'venue:dashboard_update',
    OWNER_STATS_UPDATE: 'venue:owner_stats_update',
    
    // Social Events
    SOCIAL_PROOF_UPDATED: 'venue:social_proof_updated',
    PRESENCE_UPDATED: 'venue:presence_updated'
};

// Venue event handlers
const venueEvents = {
    // State Events
    emitVenueUpdated(venueId, data) {
        eventBus.emit(VENUE_EVENTS.VENUE_UPDATED, { venueId, ...data });
    },

    emitStateChanged(venueId, state) {
        eventBus.emit(VENUE_EVENTS.VENUE_STATE_CHANGED, { venueId, state });
    },

    emitMetricsUpdated(venueId, metrics) {
        eventBus.emit(VENUE_EVENTS.VENUE_METRICS_UPDATED, { venueId, metrics });
    },

    // Optimization Events
    emitOptimizationNeeded(venueId, data) {
        eventBus.emit(VENUE_EVENTS.OPTIMIZATION_NEEDED, { venueId, ...data });
    },

    emitOptimizationApplied(venueId, optimizations) {
        eventBus.emit(VENUE_EVENTS.OPTIMIZATION_APPLIED, { venueId, optimizations });
    },

    // Message Events
    emitMessageProcessed(venueId, message) {
        eventBus.emit(VENUE_EVENTS.MESSAGE_PROCESSED, { venueId, message });
    },

    emitMessageBatchProcessed(venueId, messages) {
        eventBus.emit(VENUE_EVENTS.MESSAGE_BATCH_PROCESSED, { venueId, messages });
    },

    // Connection Events
    emitClientJoined(venueId, clientData) {
        eventBus.emit(VENUE_EVENTS.CLIENT_JOINED, { venueId, ...clientData });
    },

    emitClientLeft(venueId, clientData) {
        eventBus.emit(VENUE_EVENTS.CLIENT_LEFT, { venueId, ...clientData });
    },

    // Dashboard Events
    emitDashboardUpdate(venueId, data) {
        eventBus.emit(VENUE_EVENTS.DASHBOARD_UPDATE, { venueId, ...data });
    },

    emitOwnerStatsUpdate(venueId, stats) {
        eventBus.emit(VENUE_EVENTS.OWNER_STATS_UPDATE, { venueId, stats });
    },

    // Social Events
    emitSocialProofUpdated(venueId, data) {
        eventBus.emit(VENUE_EVENTS.SOCIAL_PROOF_UPDATED, { venueId, ...data });
    },

    emitPresenceUpdated(venueId, presenceData) {
        eventBus.emit(VENUE_EVENTS.PRESENCE_UPDATED, { venueId, ...presenceData });
    },

    // Event Handlers
    onVenueUpdated(handler) {
        eventBus.on(VENUE_EVENTS.VENUE_UPDATED, handler);
    },

    onStateChanged(handler) {
        eventBus.on(VENUE_EVENTS.VENUE_STATE_CHANGED, handler);
    },

    onMetricsUpdated(handler) {
        eventBus.on(VENUE_EVENTS.VENUE_METRICS_UPDATED, handler);
    },

    onOptimizationNeeded(handler) {
        eventBus.on(VENUE_EVENTS.OPTIMIZATION_NEEDED, handler);
    },

    onOptimizationApplied(handler) {
        eventBus.on(VENUE_EVENTS.OPTIMIZATION_APPLIED, handler);
    },

    onMessageProcessed(handler) {
        eventBus.on(VENUE_EVENTS.MESSAGE_PROCESSED, handler);
    },

    onMessageBatchProcessed(handler) {
        eventBus.on(VENUE_EVENTS.MESSAGE_BATCH_PROCESSED, handler);
    },

    onClientJoined(handler) {
        eventBus.on(VENUE_EVENTS.CLIENT_JOINED, handler);
    },

    onClientLeft(handler) {
        eventBus.on(VENUE_EVENTS.CLIENT_LEFT, handler);
    },

    onDashboardUpdate(handler) {
        eventBus.on(VENUE_EVENTS.DASHBOARD_UPDATE, handler);
    },

    onOwnerStatsUpdate(handler) {
        eventBus.on(VENUE_EVENTS.OWNER_STATS_UPDATE, handler);
    },

    onSocialProofUpdated(handler) {
        eventBus.on(VENUE_EVENTS.SOCIAL_PROOF_UPDATED, handler);
    },

    onPresenceUpdated(handler) {
        eventBus.on(VENUE_EVENTS.PRESENCE_UPDATED, handler);
    }
};

module.exports = {
    VENUE_EVENTS,
    venueEvents
}; 