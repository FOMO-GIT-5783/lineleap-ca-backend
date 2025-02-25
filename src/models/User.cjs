const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    role: {
        type: String,
        enum: ['customer', 'staff', 'owner', 'admin'],
        default: 'customer'
    },
    auth0Id: {
        type: String,
        unique: true,
        sparse: true
    },
    likedVenues: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Venue'
    }],
    friends: {
        type: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }],
        default: []
    },
    friendRequests: [{
        from: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'rejected'],
            default: 'pending'
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    // For venue owners
    managedVenues: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Venue'
    }],
    // For customers
    passes: [{
        type: {
            type: String,
            enum: ['cover', 'fomo'],
            required: true
        },
        venue: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Venue'
        },
        purchasedAt: Date,
        expiresAt: Date,
        status: {
            type: String,
            enum: ['active', 'used', 'expired']
        },
        amount: Number,
        passId: String
    }],
    purchaseHistory: [{
        venue: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Venue'
        },
        purchasedAt: Date,
        amount: Number,
        status: String
    }],
    transactionHistory: [{
        type: {
            type: String,
            enum: ['purchase', 'refund'],
            required: true
        },
        amount: Number,
        venue: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Venue'
        },
        status: String,
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    // Activity tracking
    activityHistory: [{
        type: {
            type: String,
            enum: ['check-in', 'like', 'purchase'],
            required: true
        },
        venue: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Venue',
            required: true
        },
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    profile: {
        name: String,
        email: String,
        picture: String
    },
    preferences: {
        notifications: {
            orderUpdates: { type: Boolean, default: true },
            promotions: { type: Boolean, default: true }
        },
        favoriteVenues: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Venue'
        }]
    },
    lastActive: Date,
    deviceTokens: [String]
}, {
    timestamps: true
});

// Define all indexes in one place
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ auth0Id: 1 }, { unique: true, sparse: true });
userSchema.index({ 'transactionHistory.timestamp': 1 });
userSchema.index({ 'activityHistory.timestamp': 1 });
userSchema.index({ lastActive: 1 });
userSchema.index({ 'managedVenues': 1 });

const User = mongoose.model('User', userSchema);

module.exports = User; 