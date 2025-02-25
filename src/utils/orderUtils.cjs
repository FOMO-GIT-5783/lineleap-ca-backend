const crypto = require('crypto');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');

// Generate a 6-digit verification code
const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Calculate order total with tips
const calculateOrderTotal = (items, tipPercentage = 0) => {
    const subtotal = items.reduce((total, item) => {
        return total + (item.price * item.quantity);
    }, 0);

    const tip = subtotal * (tipPercentage / 100);
    const total = subtotal + tip;

    return {
        subtotal: parseFloat(subtotal.toFixed(2)),
        tip: parseFloat(tip.toFixed(2)),
        total: parseFloat(total.toFixed(2))
    };
};

// Validate order items against menu
const validateOrderItems = (items, menuItems) => {
    const errors = [];
    const menuItemMap = new Map(menuItems.map(item => [item._id.toString(), item]));

    items.forEach(item => {
        const menuItem = menuItemMap.get(item.menuItemId.toString());
        if (!menuItem) {
            errors.push(`Menu item ${item.menuItemId} not found`);
            return;
        }

        if (!menuItem.isAvailable) {
            errors.push(`Menu item ${menuItem.name} is not available`);
        }

        if (item.quantity <= 0) {
            errors.push(`Invalid quantity for item ${menuItem.name}`);
        }

        if (item.price !== menuItem.price) {
            errors.push(`Price mismatch for item ${menuItem.name}`);
        }
    });

    return {
        isValid: errors.length === 0,
        errors
    };
};

// Format order for display
const formatOrderForDisplay = (order) => {
    return {
        id: order._id,
        status: order.status,
        items: order.items.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.price * item.quantity,
            specialInstructions: item.specialInstructions || ''
        })),
        totals: {
            subtotal: order.subtotal,
            tip: order.tip,
            total: order.total
        },
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        statusHistory: order.statusHistory.map(history => formatOrderHistory(history))
    };
};

// Format order history
const formatOrderHistory = (history) => ({
    status: history.status,
    timestamp: history.timestamp,
    by: history.staffId ? 'Staff' : 'System'
});

// Generate unique order reference
const generateOrderReference = () => {
    const timestamp = Date.now().toString(36);
    const randomStr = crypto.randomBytes(3).toString('hex');
    return `${timestamp}-${randomStr}`.toUpperCase();
};

// Robust order number generation
const generateOrderNumber = async (type, session) => {
    const date = new Date();
    const prefix = type === 'drink' ? 'D' : 'P';
    const timestamp = date.getTime().toString(36);
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    const candidate = `${prefix}${timestamp}${random}`;
    
    // Ensure uniqueness
    const existing = await Order.findOne({ orderNumber: candidate }, null, { session });
    if (existing) {
        return generateOrderNumber(type, session);
    }
    return candidate;
};

// Transaction retry utility
const MAX_RETRIES = 3;
const handleWithRetry = async (fn, description = '') => {
    let lastError;
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            console.error(`Retry ${i + 1}/${MAX_RETRIES} failed for ${description}:`, error);
            if (i < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
            }
        }
    }
    throw createError.business(
        ERROR_CODES.OPERATION_FAILED,
        `Operation failed after ${MAX_RETRIES} retries: ${description}`,
        { originalError: lastError.message }
    );
};

// Price locking utility
const acquirePriceLock = async (queueManager, venueId, itemIds, duration = 5 * 60 * 1000) => {
    const lockId = `price_lock:${venueId}:${itemIds.sort().join(',')}`;
    const acquired = await queueManager.acquireLock(lockId, duration);
    if (!acquired) {
        throw createError.business(
            ERROR_CODES.LOCK_ACQUISITION_FAILED,
            'Unable to acquire price lock. Please try again.'
        );
    }
    return lockId;
};

// Validation utilities
const validateOrderTotal = (calculatedTotal, stripeAmount) => {
    const roundedCalculated = Math.round(calculatedTotal * 100);
    if (roundedCalculated !== stripeAmount) {
        throw createError.validation(
            ERROR_CODES.AMOUNT_MISMATCH,
            'Order amount mismatch',
            { 
                calculated: roundedCalculated,
                received: stripeAmount
            }
        );
    }
};

module.exports = {
    generateVerificationCode,
    calculateOrderTotal,
    validateOrderItems,
    formatOrderForDisplay,
    generateOrderReference,
    generateOrderNumber,
    handleWithRetry,
    acquirePriceLock,
    validateOrderTotal
}; 