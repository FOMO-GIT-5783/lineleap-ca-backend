const mongoose = require('mongoose');

const passSchema = new mongoose.Schema({
    venueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Venue',
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        required: true,
        enum: ['LineSkip', 'VIP', 'Premium', 'DrinkDeal', 'Other'],
        index: true
    },
    paymentIntentId: {
        type: String,
        required: true,
        unique: true
    },
    idempotencyKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    purchaseAmount: {
        type: Number,
        required: true
    },
    purchaseDate: {
        type: Date,
        required: true,
        index: true
    },
    status: {
        type: String,
        required: true,
        enum: ['active', 'redeemed', 'expired', 'cancelled'],
        default: 'active',
        index: true
    },
    statusHistory: [{
        status: {
            type: String,
            required: true,
            enum: ['active', 'redeemed', 'expired', 'cancelled']
        },
        timestamp: {
            type: Date,
            required: true
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    }],
    redemptionStatus: {
        redeemedAt: Date,
        redeemedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        location: String
    },
    customAnswers: [{
        question: String,
        answer: String
    }]
});

// Indexes for common queries
passSchema.index({ venueId: 1, type: 1, status: 1 });
passSchema.index({ userId: 1, status: 1 });
passSchema.index({ purchaseDate: 1, status: 1 });
passSchema.index({ idempotencyKey: 1 }, { unique: true });

// Virtual for pass age
passSchema.virtual('age').get(function() {
    return Date.now() - this.purchaseDate.getTime();
});

// Method to check if pass is valid
passSchema.methods.isValid = function() {
    return this.status === 'active';
};

// Method to redeem pass
passSchema.methods.redeem = async function(redeemedBy, location) {
    if (!this.isValid()) {
        throw new Error('Pass is not valid for redemption');
    }

    this.status = 'redeemed';
    this.statusHistory.push({
        status: 'redeemed',
        timestamp: new Date(),
        updatedBy: redeemedBy
    });
    this.redemptionStatus = {
        redeemedAt: new Date(),
        redeemedBy,
        location
    };

    await this.save();
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
        status: { $in: ['active', 'redeemed'] }
    });
};

// Create model if it doesn't exist
const Pass = mongoose.models.Pass || mongoose.model('Pass', passSchema);

module.exports = Pass; 