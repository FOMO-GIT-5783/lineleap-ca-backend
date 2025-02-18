const { CORE_METRIC_TYPES } = require('./halifax');

// Simple static config (Phase 1 only)
module.exports = {
    [CORE_METRIC_TYPES.PASS.PURCHASE]: 1.0,
    [CORE_METRIC_TYPES.DRINK.ORDER]: 1.0
}; 