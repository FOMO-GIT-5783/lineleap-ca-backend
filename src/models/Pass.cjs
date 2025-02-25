const mongoose = require('mongoose');

const passSchema = new mongoose.Schema({
    venueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Venue',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['drink', 'skipline']
    },
    status: {
        type: String,
        required: true,
        enum: ['active', 'used', 'expired', 'cancelled'],
        default: 'active'
    },
    purchaseAmount: {
        type: Number,
        required: true
    },
    purchaseDate: {
        type: Date,
        required: true
    },
    paymentIntentId: {
        type: String,
        required: true
    },
    idempotencyKey: {
        type: String,
        required: true
    },
    // Simplified usage tracking
    usedAt: Date,
    lastUsedDeviceId: String,
    
    // Keep status history for analytics
    statusHistory: [{
        status: {
            type: String,
            required: true,
            enum: ['active', 'used', 'expired', 'cancelled']
        },
        timestamp: {
            type: Date,
            required: true
        }
    }],
    
    // Keep custom answers for future use
    customAnswers: [{
        question: String,
        answer: String
    }]
}, {
    timestamps: true
});

// Define all indexes in one place
passSchema.index({ venueId: 1 });
passSchema.index({ userId: 1 });
passSchema.index({ paymentIntentId: 1 }, { unique: true });
passSchema.index({ idempotencyKey: 1 }, { unique: true });
passSchema.index({ venueId: 1, type: 1, status: 1 }); // Combined index for venue pass management
passSchema.index({ userId: 1, status: 1 }); // Combined index for user pass management
passSchema.index({ purchaseDate: 1, status: 1 }); // Combined index for pass expiration

// Virtual for pass age
passSchema.virtual('age').get(function() {
    return Date.now() - this.purchaseDate.getTime();
});

// Method to check if pass is valid
passSchema.methods.isValid = function() {
    return this.status === 'active';
};

// Updated method to use pass
passSchema.methods.use = async function(deviceId) {
    if (!this.isValid()) {
        throw new Error('Pass is not valid for use');
    }

    const now = new Date();
    
    // For drink passes, mark as used
    if (this.type === 'drink') {
        this.status = 'used';
        this.usedAt = now;
    }
    
    // For skipline passes, just update lastUsed
    if (this.type === 'skipline') {
        this.lastUsedDeviceId = deviceId;
    }
    
    this.statusHistory.push({
        status: this.status,
        timestamp: now
    });

    await this.save();
    return this;
};

// Static method to get active passes for a venue
passSchema.statics.getActiveForVenue = function(venueId) {
    return this.find({
        venueId,
        status: 'active'
    }).sort({ purchaseDate: 1 });
};

// Static method to get daily pass count
passSchema.statics.getDailyCount = async function(venueId, type) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.countDocuments({
        venueId,
        type,
        purchaseDate: { $gte: startOfDay },
        status: { $in: ['active', 'used'] }
    });
};

// Create model
const Pass = mongoose.models.Pass || mongoose.model('Pass', passSchema);

module.exports = Pass; 