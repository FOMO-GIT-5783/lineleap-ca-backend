const mongoose = require('mongoose');
const { createError, ERROR_CODES } = require('./errors.cjs');

// Date validation
const validateDate = (date, { required = false, future = false, past = false } = {}) => {
    if (!date && required) {
        throw createError.validation(
            ERROR_CODES.MISSING_REQUIRED_FIELD,
            'Date is required'
        );
    }

    if (!date) return true;

    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Invalid date format'
        );
    }

    const now = new Date();
    if (future && dateObj < now) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Date must be in the future'
        );
    }

    if (past && dateObj > now) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Date must be in the past'
        );
    }

    return true;
};

// Date range validation
const validateDateRange = (startDate, endDate, maxDays = null) => {
    validateDate(startDate, { required: true });
    validateDate(endDate, { required: true });

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end < start) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'End date must be after start date'
        );
    }

    if (maxDays) {
        const daysDiff = (end - start) / (1000 * 60 * 60 * 24);
        if (daysDiff > maxDays) {
            throw createError.validation(
                ERROR_CODES.INVALID_INPUT,
                `Date range cannot exceed ${maxDays} days`
            );
        }
    }

    return { startDate: start, endDate: end };
};

// MongoDB ObjectId validation
const validateObjectId = (id, { required = false, field = 'ID' } = {}) => {
    if (!id && required) {
        throw createError.validation(
            ERROR_CODES.MISSING_REQUIRED_FIELD,
            `${field} is required`
        );
    }

    if (!id) return true;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            `Invalid ${field} format`
        );
    }

    return true;
};

// Price validation
const validatePrice = (price, { required = false, min = 0, max = null } = {}) => {
    if ((price === undefined || price === null) && required) {
        throw createError.validation(
            ERROR_CODES.MISSING_REQUIRED_FIELD,
            'Price is required'
        );
    }

    if (price === undefined || price === null) return true;

    if (typeof price !== 'number' || isNaN(price)) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Price must be a number'
        );
    }

    if (price < min) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            `Price cannot be less than ${min}`
        );
    }

    if (max !== null && price > max) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            `Price cannot exceed ${max}`
        );
    }

    return true;
};

// Array validation
const validateArray = (array, { required = false, minLength = null, maxLength = null, itemValidator = null } = {}) => {
    if (!array && required) {
        throw createError.validation(
            ERROR_CODES.MISSING_REQUIRED_FIELD,
            'Array is required'
        );
    }

    if (!array) return true;

    if (!Array.isArray(array)) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Value must be an array'
        );
    }

    if (minLength !== null && array.length < minLength) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            `Array must contain at least ${minLength} items`
        );
    }

    if (maxLength !== null && array.length > maxLength) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            `Array cannot contain more than ${maxLength} items`
        );
    }

    if (itemValidator) {
        array.forEach((item, index) => {
            try {
                itemValidator(item);
            } catch (error) {
                throw createError.validation(
                    ERROR_CODES.INVALID_INPUT,
                    `Invalid item at index ${index}: ${error.message}`
                );
            }
        });
    }

    return true;
};

// String validation
const validateString = (str, { required = false, minLength = null, maxLength = null, pattern = null, enum: enumValues = null } = {}) => {
    if (!str && required) {
        throw createError.validation(
            ERROR_CODES.MISSING_REQUIRED_FIELD,
            'String is required'
        );
    }

    if (!str) return true;

    if (typeof str !== 'string') {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Value must be a string'
        );
    }

    if (minLength !== null && str.length < minLength) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            `String must be at least ${minLength} characters long`
        );
    }

    if (maxLength !== null && str.length > maxLength) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            `String cannot exceed ${maxLength} characters`
        );
    }

    if (pattern && !pattern.test(str)) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'String format is invalid'
        );
    }

    if (enumValues && !enumValues.includes(str)) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            `Value must be one of: ${enumValues.join(', ')}`
        );
    }

    return true;
};

// Number validation
const validateNumber = (num, { required = false, min = null, max = null, integer = false } = {}) => {
    if ((num === undefined || num === null) && required) {
        throw createError.validation(
            ERROR_CODES.MISSING_REQUIRED_FIELD,
            'Number is required'
        );
    }

    if (num === undefined || num === null) return true;

    if (typeof num !== 'number' || isNaN(num)) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Value must be a number'
        );
    }

    if (integer && !Number.isInteger(num)) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Value must be an integer'
        );
    }

    if (min !== null && num < min) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            `Value cannot be less than ${min}`
        );
    }

    if (max !== null && num > max) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            `Value cannot exceed ${max}`
        );
    }

    return true;
};

// Boolean validation
const validateBoolean = (bool, { required = false } = {}) => {
    if ((bool === undefined || bool === null) && required) {
        throw createError.validation(
            ERROR_CODES.MISSING_REQUIRED_FIELD,
            'Boolean is required'
        );
    }

    if (bool === undefined || bool === null) return true;

    if (typeof bool !== 'boolean') {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Value must be a boolean'
        );
    }

    return true;
};

// Email validation
const validateEmail = (email, { required = false } = {}) => {
    if (!email && required) {
        throw createError.validation(
            ERROR_CODES.MISSING_REQUIRED_FIELD,
            'Email is required'
        );
    }

    if (!email) return true;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Invalid email format'
        );
    }

    return true;
};

// Phone number validation
const validatePhone = (phone, { required = false } = {}) => {
    if (!phone && required) {
        throw createError.validation(
            ERROR_CODES.MISSING_REQUIRED_FIELD,
            'Phone number is required'
        );
    }

    if (!phone) return true;

    const phoneRegex = /^\+?1?\d{10,14}$/;
    if (!phoneRegex.test(phone.replace(/\D/g, ''))) {
        throw createError.validation(
            ERROR_CODES.INVALID_INPUT,
            'Invalid phone number format'
        );
    }

    return true;
};

module.exports = {
    validateDate,
    validateDateRange,
    validateObjectId,
    validatePrice,
    validateArray,
    validateString,
    validateNumber,
    validateBoolean,
    validateEmail,
    validatePhone
}; 