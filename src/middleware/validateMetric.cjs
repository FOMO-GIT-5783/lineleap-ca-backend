const { FOMO_METRIC_TYPES } = require('../schemas/metrics');

// Phase 0 allowed metric types
const PHASE0_ALLOWED_TYPES = [
    FOMO_METRIC_TYPES.REVENUE.PASS,
    FOMO_METRIC_TYPES.REVENUE.DRINK,
    FOMO_METRIC_TYPES.CAPACITY.CHECKINS,
    FOMO_METRIC_TYPES.OPERATIONS.PAYMENT_FAILURES
];

/**
 * Middleware to validate metric type before processing
 */
export const validateMetricType = (req, res, next) => {
    if (!PHASE0_ALLOWED_TYPES.includes(req.body.type)) {
        return res.status(400).json({
            error: `Phase 0 metric only. Allowed: ${PHASE0_ALLOWED_TYPES.join(', ')}`
        });
    }
    next();
}; 