const mongoose = require('mongoose');
const { isPeakTime } = require('../utils/halifaxTime.cjs');
const { CORE_METRIC_TYPES } = require('../config/halifax.cjs');

// Temporary fix to unblock metrics
const metricUnification = process.env.NODE_ENV === 'test'
    ? require('./unstableMetrics.cjs')
    : {
        record: (type, data) => {
            console.warn('Using fallback metric recording for:', type);
            return mongoose.model('Metric').create({
                type,
                venueId: data.venueId,
                value: data.value || 1,
                timestamp: data.timestamp || new Date(),
                _fallback: true
            });
        }
    };

class MetricRecorder {
    constructor() {
        this.record = this.record.bind(this);
    }

    async record(metricType, data) {
        if (metricUnification) {
            return metricUnification.record(metricType, data);
        }

        // Fallback to basic recording
        return mongoose.model('Metric').create({
            type: metricType,
            venueId: data.venueId,
            value: data.value || 1,
            timestamp: data.timestamp || new Date(),
            _fallback: true
        });
    }
}

module.exports = {
    MetricRecorder,
    CORE_METRIC_TYPES,
    metricUnification
}; 