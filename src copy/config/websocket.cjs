const HALIFAX_WS_CONFIG = {
    compression: {
        enabled: true,
        defaultThreshold: 25,
        venueOverrides: {},
        maxPayloadSize: 16 * 1024 // 16kb
    },
    connection: {
        pingInterval: 25000,
        pingTimeout: 60000,
        perVenueLimit: 200
    },
    thresholds: {
        normal: 30,
        warning: 50,
        critical: 75
    },
    optimization: {
        batchingEnabled: true,
        batchSize: 100,
        batchWait: 50 // ms
    }
};

// Load any venue-specific overrides from environment
const loadVenueOverrides = () => {
    try {
        const overrides = process.env.VENUE_WS_OVERRIDES 
            ? JSON.parse(process.env.VENUE_WS_OVERRIDES)
            : {};
        HALIFAX_WS_CONFIG.compression.venueOverrides = overrides;
    } catch (error) {
        console.error('Failed to parse venue WebSocket overrides:', error);
    }
};

loadVenueOverrides();

module.exports = {
    HALIFAX_WS_CONFIG,
    getVenueThreshold: (venueId) => 
        HALIFAX_WS_CONFIG.compression.venueOverrides[venueId] || 
        HALIFAX_WS_CONFIG.compression.defaultThreshold
}; 