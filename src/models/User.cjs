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
    enum: ['customer', 'bartender', 'owner', 'admin'],
    required: true
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
      default: Date.now,
      index: true
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

const User = mongoose.model('User', userSchema);
module.exports = { User };

