// validationMiddleware.js

let authMiddleware;
const {
    validateString,
    validateNumber,
    validateArray,
    validateDate,
    validateDateRange,
    validateObjectId,
    validatePrice,
    validateEmail,
    validatePhone
} = require('../utils/validators.cjs');
const { VENUE_TYPES, MUSIC_TYPES, PASS_TYPES, SCHEDULE_TYPES } = require('../utils/constants.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');

// Lazy load auth middleware
const getAuthMiddleware = () => {
    if (!authMiddleware) {
        authMiddleware = require('./authMiddleware.cjs');
    }
    return authMiddleware;
};

// Add token validation function
const validateToken = (token) => {
    if (!token) return false;
    return true; // Basic validation, extend as needed
};

// Venue validation middleware
const validateVenue = (req, res, next) => {
    try {
        const { name, type, music, location, operatingHours } = req.body;

        // Basic fields
        validateString(name, { required: true, minLength: 2, maxLength: 100 });
        validateString(type, { required: true, enum: VENUE_TYPES });
        validateString(music, { required: true, enum: MUSIC_TYPES });

        // Location
        if (!location) {
            throw createError.validation(
                ERROR_CODES.MISSING_REQUIRED_FIELD,
                'Location is required'
            );
        }

        validateString(location.address, { required: true });
        validateString(location.city, { required: true });
        validateString(location.province, { required: true });
        validateString(location.postalCode, { required: true });

        // Operating hours
        if (!operatingHours) {
            throw createError.validation(
                ERROR_CODES.MISSING_REQUIRED_FIELD,
                'Operating hours are required'
            );
        }

        validateString(operatingHours.open, { required: true });
        validateString(operatingHours.close, { required: true });
        validateArray(operatingHours.daysOpen, { required: true, minLength: 1 });

        next();
    } catch (error) {
        next(error);
    }
};

// Pass validation middleware
const validatePass = (req, res, next) => {
    try {
        const { type, name, price, maxDaily, description, instructions } = req.body;

        validateString(type, { required: true, enum: PASS_TYPES });
        validateString(name, { required: true, minLength: 2, maxLength: 100 });
        validatePrice(price, { required: true });
        validateNumber(maxDaily, { required: true, min: 1 });
        validateString(description, { required: true });
        validateString(instructions, { required: true });

        next();
    } catch (error) {
        next(error);
    }
};

// Schedule validation middleware
const validateSchedule = (req, res, next) => {
    try {
        const { scheduleType, startDate, endDate, daysOfWeek, customDates } = req.body;

        validateString(scheduleType, { required: true, enum: SCHEDULE_TYPES });

        if (scheduleType === 'continuous') {
            validateDate(startDate, { required: true, future: true });
            if (endDate) {
                validateDateRange(startDate, endDate);
            }
        }

        if (scheduleType === 'dayOfWeek') {
            validateArray(daysOfWeek, { 
                required: true,
                minLength: 1,
                itemValidator: (day) => validateString(day, { enum: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] })
            });
        }

        if (scheduleType === 'customDays') {
            validateArray(customDates, {
                required: true,
                minLength: 1,
                itemValidator: (date) => {
                    validateDate(date.date, { required: true, future: true });
                    validatePrice(date.price, { required: true });
                    validateNumber(date.inventory, { required: true, min: 1 });
                }
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};

// Order validation middleware
const validateOrder = (req, res, next) => {
    try {
        const { venueId, items, tip } = req.body;

        validateObjectId(venueId, { required: true, field: 'Venue ID' });
        validateArray(items, {
            required: true,
            minLength: 1,
            itemValidator: (item) => {
                validateObjectId(item.menuItemId, { required: true, field: 'Menu Item ID' });
                validateNumber(item.quantity, { required: true, min: 1, integer: true });
                validatePrice(item.price, { required: true });
            }
        });
        if (tip !== undefined) {
            validatePrice(tip, { min: 0 });
        }

        next();
    } catch (error) {
        next(error);
    }
};

// Date range validation middleware
const validateDates = (maxDays = null) => (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        if (startDate || endDate) {
            const validatedDates = validateDateRange(startDate, endDate, maxDays);
            req.dateRange = validatedDates;
        }
        next();
    } catch (error) {
        next(error);
    }
};

// ID validation middleware
const validateId = (paramName, fieldName = 'ID') => (req, res, next) => {
    try {
        const id = req.params[paramName];
        validateObjectId(id, { required: true, field: fieldName });
        next();
    } catch (error) {
        next(error);
    }
};

// Payment validation middleware
const validatePayment = (req, res, next) => {
    try {
        const { items, tipAmount, venueId } = req.body;

        // Validate venueId
        validateObjectId(venueId, { 
            required: true, 
            field: 'Venue ID' 
        });

        // Validate items array
        validateArray(items, {
            required: true,
            minLength: 1,
            itemValidator: (item) => {
                validateObjectId(item.menuItemId || item.passId, { 
                    required: true, 
                    field: 'Item ID' 
                });
                validateNumber(item.quantity, { 
                    required: true, 
                    min: 1, 
                    integer: true 
                });
                validatePrice(item.price, { 
                    required: true, 
                    min: 0 
                });
                if (item.specialInstructions) {
                    validateString(item.specialInstructions, { 
                        maxLength: 500 
                    });
                }
            }
        });

        // Validate tip amount
        if (tipAmount !== undefined) {
            validatePrice(tipAmount, { 
                min: 0 
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};

// Pass purchase validation middleware
const validatePassPurchase = (req, res, next) => {
    try {
        const { venueId, passType, purchasePrice } = req.body;

        // Validate venueId
        validateObjectId(venueId, { 
            required: true, 
            field: 'Venue ID' 
        });

        // Validate pass type
        validateString(passType, { 
            required: true, 
            enum: PASS_TYPES 
        });

        // Validate purchase price
        validatePrice(purchasePrice, { 
            required: true, 
            min: 0 
        });

        next();
    } catch (error) {
        next(error);
    }
};

module.exports = {
    validateVenue,
    validatePass,
    validateSchedule,
    validateOrder,
    validateDates,
    validateId,
    validatePayment,
    validatePassPurchase,
    validateToken
};

