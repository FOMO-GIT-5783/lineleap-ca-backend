const { config } = require('./environment.cjs');

// Base rate limits
const BASE_LIMITS = {
    orderCreation: 30,  // 30 requests per 15 minutes
    passValidation: 20, // 20 requests per 15 minutes
    websocketConnections: 75 // Max concurrent connections per venue
};

// Peak hours configuration (8 PM to 3 AM)
const PEAK_HOURS = {
    start: 20, // 8 PM
    end: 3     // 3 AM
};

// Venue-specific overrides (can be adjusted per venue)
const VENUE_OVERRIDES = {
    // Example override for a high-traffic venue
    // 'venue-id': {
    //     orderCreation: 45,
    //     passValidation: 30,
    //     websocketConnections: 100
    // }
};

function isPeakHour() {
    const hour = new Date().getHours();
    return hour >= PEAK_HOURS.start || hour <= PEAK_HOURS.end;
}

function getVenueLimits(venueId) {
    const venueOverride = VENUE_OVERRIDES[venueId];
    const baseLimits = { ...BASE_LIMITS };

    // Apply venue-specific overrides if they exist
    if (venueOverride) {
        return { ...baseLimits, ...venueOverride };
    }

    // Apply peak hour adjustments
    if (isPeakHour()) {
        return {
            orderCreation: Math.ceil(baseLimits.orderCreation * 1.5),
            passValidation: Math.ceil(baseLimits.passValidation * 1.5),
            websocketConnections: Math.ceil(baseLimits.websocketConnections * 1.2)
        };
    }

    return baseLimits;
}

// Export configuration
module.exports = {
    BASE_LIMITS,
    PEAK_HOURS,
    getVenueLimits,
    isPeakHour
}; 