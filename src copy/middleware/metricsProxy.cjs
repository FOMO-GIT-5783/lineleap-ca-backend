const { FOMO_METRIC_TYPES } = require('../schemas/metrics.cjs');

const metricProxy = (fn, metricType) => {
    return async (...args) => {
        const result = await fn(...args);
        
        // Ensure result has required fields
        if (!result || typeof result !== 'object') {
            throw new Error('Metric proxy requires an object return value');
        }

        // Add metric type and timestamp if not present
        result.type = result.type || metricType;
        result.timestamp = result.timestamp || new Date();

        // Normalize values to 2 decimal places for consistency
        if (result.revenue) {
            Object.keys(result.revenue).forEach(key => {
                if (typeof result.revenue[key] === 'number') {
                    result.revenue[key] = Number(result.revenue[key].toFixed(2));
                }
            });
        }

        return result;
    };
};

module.exports = { metricProxy }; 