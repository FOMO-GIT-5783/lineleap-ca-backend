const { FOMO_METRIC_TYPES } = require('../schemas/metrics.cjs');
const mongoose = require('mongoose');

const metricSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: Object.values(FOMO_METRIC_TYPES).flatMap(c => Object.values(c)),
        required: true
    },
    venueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Venue',
        required: true
    },
    value: Number,
    timestamp: {
        type: Date,
        default: Date.now
    },
    context: {
        isPeakHour: Boolean,
        surgeMultiplier: Number
    }
});

// Define all indexes in one place
metricSchema.index({ venueId: 1 });
metricSchema.index({ timestamp: 1 });
metricSchema.index({ venueId: 1, type: 1, timestamp: -1 });

// Add index verification on model compilation
metricSchema.post('compile', function(model) {
    const indexes = model.schema.indexes();
    if (!indexes.some(i => i[0].venueId && i[0].type && i[0].timestamp)) {
        throw new Error('Missing required compound index on Metric schema');
    }
});

module.exports = mongoose.model('Metric', metricSchema); 