const EventEmitter = require('events');
const { ORDER_EVENTS } = require('./constants.cjs');

class EventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(20); // Increase max listeners if needed
    }

    // Order Events
    emitOrderUpdate(orderId, status, data = {}) {
        this.emit('orderUpdate', { orderId, status, ...data, timestamp: new Date() });
    }

    emitVenueUpdate(venueId, eventType, data = {}) {
        this.emit('venueUpdate', { venueId, eventType, ...data, timestamp: new Date() });
    }

    emitMetricsUpdate(venueId, metrics) {
        this.emit('metricsUpdate', { venueId, metrics, timestamp: new Date() });
    }

    // Dashboard Events
    emitDashboardUpdate(venueId, type, data = {}) {
        this.emit('dashboardUpdate', { venueId, type, ...data, timestamp: new Date() });
    }

    // Verification Events
    emitVerificationNeeded(orderId, bartenderId, code) {
        this.emit('verificationNeeded', { 
            orderId, 
            bartenderId, 
            verificationCode: code,
            timestamp: new Date()
        });
    }

    emitVerificationComplete(orderId, success, data = {}) {
        this.emit('verificationComplete', {
            orderId,
            success,
            ...data,
            timestamp: new Date()
        });
    }
}

// Create a singleton instance
const eventBus = new EventBus();

module.exports = eventBus; 