const FOMO_METRIC_TYPES = Object.freeze({
    REVENUE: {
        DRINK: 'revenue.drink',
        PASS: 'revenue.pass',
        SERVICE_FEE: 'revenue.service_fee',
        TIP: 'revenue.tip'
    },
    OPERATIONS: {
        ORDER_PROCESSING: 'operations.order_processing',
        PASS_REDEMPTION: 'operations.pass_redemption',
        PAYMENT_FAILURES: 'operations.payment_failures'
    },
    SOCIAL: {
        CHECK_INS: 'social.check_ins',
        LIKES: 'social.likes',
        SHARES: 'social.shares'
    }
});

const METRIC_UNIFICATION_MAP = Object.freeze({
    'revenue.drink': {
        type: 'currency',
        aggregation: 'sum'
    },
    'revenue.pass': {
        type: 'currency',
        aggregation: 'sum'
    },
    'revenue.service_fee': {
        type: 'currency',
        aggregation: 'sum'
    },
    'revenue.tip': {
        type: 'currency',
        aggregation: 'sum'
    }
});

const METRIC_AGGREGATION_TYPES = Object.freeze({
    SUM: 'sum',
    AVG: 'avg',
    MAX: 'max',
    MIN: 'min',
    COUNT: 'count',
    PERCENTILE: 'percentile'
});

const METRIC_ALERT_LEVELS = Object.freeze({
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
});

module.exports = {
    FOMO_METRIC_TYPES,
    METRIC_UNIFICATION_MAP,
    METRIC_AGGREGATION_TYPES,
    METRIC_ALERT_LEVELS
}; 