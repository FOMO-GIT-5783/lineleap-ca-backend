const mongoose = require('mongoose');

const orderLockSchema = new mongoose.Schema({
  idempotencyKey: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['locked', 'completed', 'failed'],
    required: true,
    default: 'locked'
  },
  metadata: {
    venueId: {
      type: String,
      required: true
    },
    userId: {
      type: String,
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    items: [{
      type: mongoose.Schema.Types.Mixed,
      required: true
    }],
    paymentIntentId: String,
    error: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400 // TTL of 24 hours
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'order_locks'
});

// Define all indexes in one place
orderLockSchema.index({ idempotencyKey: 1 }, { unique: true });
orderLockSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });
orderLockSchema.index({ 'metadata.venueId': 1, 'metadata.userId': 1, createdAt: -1 });
orderLockSchema.index({ 'metadata.venueId': 1 });
orderLockSchema.index({ 'metadata.userId': 1 });

// Pre-save middleware
orderLockSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static methods
orderLockSchema.statics.findByIdempotencyKey = function(idempotencyKey) {
  return this.findOne({ idempotencyKey });
};

orderLockSchema.statics.findByVenueAndUser = function(venueId, userId) {
  return this.find({
    'metadata.venueId': venueId,
    'metadata.userId': userId
  }).sort({ createdAt: -1 });
};

// Instance methods
orderLockSchema.methods.isLocked = function() {
  return this.status === 'locked';
};

orderLockSchema.methods.complete = function(paymentIntentId) {
  this.status = 'completed';
  this.metadata.paymentIntentId = paymentIntentId;
  return this.save();
};

orderLockSchema.methods.fail = function(error) {
  this.status = 'failed';
  this.metadata.error = error;
  return this.save();
};

const OrderLock = mongoose.model('OrderLock', orderLockSchema);

module.exports = OrderLock; 