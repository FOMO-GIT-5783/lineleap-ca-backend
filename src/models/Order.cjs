const mongoose = require('mongoose');
const { ORDER_EVENTS } = require('../utils/constants.cjs');

const orderItemSchema = new mongoose.Schema({
    menuItemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MenuItem',
        required: true
    },
    name: { type: String, required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true }
});

const statusHistorySchema = new mongoose.Schema({
    status: {
        type: String,
        enum: Object.values(ORDER_EVENTS),
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const orderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    venueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Venue',
        required: true
    },
    items: [orderItemSchema],
    status: {
        type: String,
        enum: Object.values(ORDER_EVENTS),
        default: ORDER_EVENTS.CREATED
    },
    statusHistory: [statusHistorySchema],
    subtotal: { type: Number, required: true },
    tip: { type: Number, default: 0 },
    total: { type: Number, required: true },
    specialInstructions: String,
    notes: [{
        content: String,
        createdAt: { type: Date, default: Date.now },
        type: { type: String, enum: ['system', 'user'] }
    }],
    reference: { type: String, unique: true },
    createdAt: { type: Date, default: Date.now },
    completedAt: Date,
    // New payment processing fields
    idempotencyKey: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },
    transactionId: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed
    }
});

// Virtual for order age
orderSchema.virtual('age').get(function() {
    return Date.now() - this.createdAt.getTime();
});

// Virtual for processing time
orderSchema.virtual('processingTime').get(function() {
    if (this.completedAt) {
        return this.completedAt.getTime() - this.createdAt.getTime();
    }
    return Date.now() - this.createdAt.getTime();
});

// Add status to history
orderSchema.methods.addStatusHistory = function(status) {
    this.statusHistory.push({ status });
    this.status = status;
    
    if (status === ORDER_EVENTS.COMPLETED) {
        this.completedAt = new Date();
    }
};

// Indexes
orderSchema.index({ venueId: 1, createdAt: -1 });
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ reference: 1 }, { unique: true });
orderSchema.index({ status: 1 });

// Compound index for common nightlife queries (venue + status + date)
orderSchema.index({ venueId: 1, status: 1, createdAt: -1 });

// Add index for payment processing
orderSchema.index({ 'statusHistory.status': 1, 'statusHistory.timestamp': -1 });

module.exports = mongoose.model('Order', orderSchema);




