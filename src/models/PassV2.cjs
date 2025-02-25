const mongoose = require('mongoose');

const passSchemaV2 = new mongoose.Schema({
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
        enum: ['LineSkip', 'VIP', 'Premium', 'DrinkDeal', 'Other']
    },
    paymentIntentId: {
        type: String,
        required: true
    },
    idempotencyKey: {
        type: String,
        required: true
    },
    transactionId: {
        type: String,
        sparse: true
    },
    purchaseAmount: {
        type: Number,
        required: true
    },
    purchaseDate: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        required: true,
        enum: ['pending', 'active', 'redeemed', 'expired', 'cancelled', 'refunded'],
        default: 'pending'
    },
    statusHistory: [{
        status: {
            type: String,
            required: true,
            enum: ['pending', 'active', 'redeemed', 'expired', 'cancelled', 'refunded']
        },
        timestamp: {
            type: Date,
            required: true,
            default: Date.now
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        metadata: {
            type: Map,
            of: mongoose.Schema.Types.Mixed
        }
    }],
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed
    },
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

// Define all indexes in one place
passSchemaV2.index({ venueId: 1 });
passSchemaV2.index({ userId: 1 });
passSchemaV2.index({ paymentIntentId: 1 }, { unique: true });
passSchemaV2.index({ idempotencyKey: 1 }, { unique: true });
passSchemaV2.index({ transactionId: 1 }, { unique: true, sparse: true });
passSchemaV2.index({ venueId: 1, type: 1, status: 1 });
passSchemaV2.index({ userId: 1, status: 1 });
passSchemaV2.index({ purchaseDate: 1, status: 1 });

// Virtual for pass age
passSchemaV2.virtual('age').get(function() {
    return Date.now() - this.purchaseDate.getTime();
});

// Method to check if pass is valid
passSchemaV2.methods.isValid = function() {
    return this.status === 'active';
};

// Method to redeem pass
passSchemaV2.methods.redeem = async function(redeemedBy, location) {
    if (!this.isValid()) {
        throw new Error('Pass is not valid for redemption');
    }

    this.status = 'redeemed';
    this.statusHistory.push({
        status: 'redeemed',
        timestamp: new Date(),
        updatedBy: redeemedBy,
        metadata: { location }
    });
    
    this.redemptionStatus = {
        redeemedAt: new Date(),
        redeemedBy: redeemedBy,
        location: location
    };

    await this.save();
    return this;
};

module.exports = mongoose.model('Pass', passSchemaV2); 