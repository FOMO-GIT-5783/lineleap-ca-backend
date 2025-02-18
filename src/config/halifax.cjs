// Halifax-specific configuration
exports.PEAK_HOURS = {
    DAYS: ['Fri', 'Sat'],
    START_HOUR: 22, // 10 PM
    END_HOUR: 2    // 2 AM
};

// Core metric types for Phase 0
exports.CORE_METRIC_TYPES = Object.freeze({
    PASS: {
        PURCHASE: 'pass.purchase',
        REDEMPTION: 'pass.redemption' // "I Am The Doorman" clicks
    },
    DRINK: {
        ORDER: 'drink.order',
        FULFILLMENT: 'drink.fulfillment' // "I Am The Bartender" clicks
    },
    OPERATIONS: {
        PAYMENT_SUCCESS: 'ops.payment_success',
        PAYMENT_FAILURE: 'ops.payment_failure'
    }
}); 