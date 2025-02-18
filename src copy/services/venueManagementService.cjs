const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const Venue = require('../models/Venue.cjs');
const { MenuItem, DrinkCategory } = require('../models/MenuItem.cjs');
const { emitVenueUpdate } = require('../websocket/socketManager.cjs');
const mongoose = require('mongoose');

class VenueManagementService {
    // Pass Management
    static async addPass(venueId, passData) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        venue.passes.push(passData);
        await venue.save();

        emitVenueUpdate(venueId, 'passCreated', {
            pass: venue.passes[venue.passes.length - 1]
        });

        return venue.passes[venue.passes.length - 1];
    }

    static async updatePass(venueId, passId, updates) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        const pass = venue.passes.id(passId);
        if (!pass) {
            throw createError.notFound(ERROR_CODES.NOT_FOUND, 'Pass not found');
        }

        Object.assign(pass, updates);
        await venue.save();

        emitVenueUpdate(venueId, 'passUpdated', { passId, updates });
        return pass;
    }

    static async updatePassStatus(venueId, passId, status) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        const pass = venue.passes.id(passId);
        if (!pass) {
            throw createError.notFound(ERROR_CODES.NOT_FOUND, 'Pass not found');
        }

        pass.status = status;
        await venue.save();

        emitVenueUpdate(venueId, 'passStatusUpdated', { passId, status });
        return pass;
    }

    static async validatePassSchedule(venueId, passId, scheduleData) {
        const venue = await Venue.findById(venueId);
        if (!venue) throw new Error('Venue not found');

        const pass = venue.passes.id(passId);
        if (!pass) throw new Error('Pass not found');

        // Validate based on schedule type
        switch (scheduleData.scheduleType) {
            case 'continuous':
                if (!scheduleData.startDate) {
                    throw new Error('Start date is required for continuous schedule');
                }
                break;

            case 'dayOfWeek':
                if (!scheduleData.daysOfWeek || scheduleData.daysOfWeek.length === 0) {
                    throw new Error('At least one day of week must be selected');
                }
                break;

            case 'customDays':
                if (!scheduleData.customDates || scheduleData.customDates.length === 0) {
                    throw new Error('At least one custom date must be added');
                }
                // Validate each custom date
                scheduleData.customDates.forEach(date => {
                    if (!date.date || !date.price || !date.inventory) {
                        throw new Error('Each custom date must have date, price, and inventory');
                    }
                });
                break;

            default:
                throw new Error('Invalid schedule type');
        }

        return true;
    }

    static async updatePassSchedule(venueId, passId, scheduleData) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        const pass = venue.passes.id(passId);
        if (!pass) {
            throw createError.notFound(ERROR_CODES.NOT_FOUND, 'Pass not found');
        }

        // Validate schedule data based on type
        const { scheduleType, startDate, daysOfWeek, customDates } = scheduleData;

        if (scheduleType === 'continuous') {
            if (!startDate) {
                throw createError.validation(
                    ERROR_CODES.MISSING_REQUIRED_FIELD,
                    'Start date is required for continuous schedule'
                );
            }
        } else if (scheduleType === 'dayOfWeek') {
            if (!daysOfWeek?.length) {
                throw createError.validation(
                    ERROR_CODES.MISSING_REQUIRED_FIELD,
                    'At least one day of week must be selected'
                );
            }
        } else if (scheduleType === 'customDays') {
            if (!customDates?.length) {
                throw createError.validation(
                    ERROR_CODES.MISSING_REQUIRED_FIELD,
                    'At least one custom date must be added'
                );
            }
            // Validate each custom date
            for (const date of customDates) {
                if (!date.date || !date.price || !date.inventory) {
                    throw createError.validation(
                        ERROR_CODES.INVALID_INPUT,
                        'Each custom date must have date, price, and inventory'
                    );
                }
            }
        } else {
            throw createError.validation(
                ERROR_CODES.INVALID_INPUT,
                'Invalid schedule type'
            );
        }

        pass.schedule = scheduleData;
        await venue.save();
        emitVenueUpdate(venueId, 'passScheduleUpdated', { passId });
        return pass;
    }

    static async manageBlackoutDates(venueId, dates, operation) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        if (!dates?.length) {
            throw createError.validation(
                ERROR_CODES.MISSING_REQUIRED_FIELD,
                'At least one date must be provided'
            );
        }

        if (!['add', 'remove'].includes(operation)) {
            throw createError.validation(
                ERROR_CODES.INVALID_INPUT,
                'Operation must be either "add" or "remove"'
            );
        }

        await venue.manageBlackoutDates(dates, operation);

        emitVenueUpdate(venueId, 'blackoutDatesUpdate', {
            dates,
            operation,
            currentBlackoutDates: venue.blackoutDates
        });

        return venue.blackoutDates;
    }

    // Drink Menu Management
    static async addDrinkCategory(venueId, categoryData) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        const category = await DrinkCategory.create({
            ...categoryData,
            venueId
        });

        emitVenueUpdate(venueId, 'menuUpdated');
        return category;
    }

    static async updateDrinkCategory(venueId, categoryId, updates) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        const category = await DrinkCategory.findOneAndUpdate(
            { _id: categoryId, venueId },
            updates,
            { new: true }
        );

        if (!category) {
            throw createError.notFound(ERROR_CODES.NOT_FOUND, 'Category not found');
        }

        emitVenueUpdate(venueId, 'menuUpdated');
        return category;
    }

    static async addDrink(venueId, categoryId, drinkData) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        const category = await DrinkCategory.findOne({ _id: categoryId, venueId });
        if (!category) {
            throw createError.notFound(ERROR_CODES.NOT_FOUND, 'Category not found');
        }

        const drink = await MenuItem.create({
            ...drinkData,
            venueId,
            category: categoryId
        });

        emitVenueUpdate(venueId, 'menuUpdated');
        return drink;
    }

    static async updateDrink(venueId, drinkId, updates) {
        const drink = await MenuItem.findOneAndUpdate(
            { _id: drinkId, venueId },
            updates,
            { new: true }
        );

        if (!drink) {
            throw createError.notFound(ERROR_CODES.NOT_FOUND, 'Drink not found');
        }

        emitVenueUpdate(venueId, 'menuUpdated');
        return drink;
    }

    static async updateDrinkPricing(venueId, drinkId, pricing) {
        const drink = await MenuItem.findOne({ _id: drinkId, venueId });
        if (!drink) {
            throw createError.notFound(ERROR_CODES.NOT_FOUND, 'Drink not found');
        }

        drink.dailyPricing = pricing;
        await drink.save();

        emitVenueUpdate(venueId, 'menuUpdated');
        return drink;
    }

    static async reorderCategories(venueId, categoryOrder) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        if (!Array.isArray(categoryOrder) || !categoryOrder.length) {
            throw createError.validation(
                ERROR_CODES.INVALID_INPUT,
                'Category order must be a non-empty array'
            );
        }

        // Update display order for each category
        const updatedCategories = [];
        categoryOrder.forEach((categoryId, index) => {
            const category = venue.ordering.menuSections.id(categoryId);
            if (category) {
                category.displayOrder = index;
                updatedCategories.push(category);
            }
        });

        if (updatedCategories.length !== categoryOrder.length) {
            throw createError.validation(
                ERROR_CODES.INVALID_INPUT,
                'Some category IDs were not found'
            );
        }

        await venue.save();
        emitVenueUpdate(venueId, 'categoriesReordered', { newOrder: categoryOrder });
        return venue.ordering.menuSections;
    }

    static async toggleDrinkOrdering(venueId, enabled) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        venue.ordering.orderingEnabled = enabled;
        await venue.save();

        emitVenueUpdate(venueId, 'drinkOrderingToggled', { enabled });
        return venue.ordering;
    }

    static async updateServiceFee(venueId, serviceFee) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        venue.drinkOrdering.serviceFee = serviceFee;
        await venue.save();

        emitVenueUpdate(venueId, 'settingsUpdated');
        return venue;
    }

    static async updateTippingOptions(venueId, tippingData) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        if (!Array.isArray(tippingData.options)) {
            throw createError.validation(
                ERROR_CODES.INVALID_INPUT,
                'Tipping options must be an array'
            );
        }

        // Validate tipping options
        tippingData.options.forEach(option => {
            if (typeof option.percentage !== 'number' || option.percentage < 0) {
                throw createError.validation(
                    ERROR_CODES.INVALID_INPUT,
                    'Invalid tipping percentage'
                );
            }
        });

        venue.drinkOrdering.tipping = tippingData;
        await venue.save();

        emitVenueUpdate(venueId, 'tippingUpdated', { tipping: tippingData });
        return venue.drinkOrdering;
    }

    static async toggleServiceFee(venueId, passId, enabled, amount = 0) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        const pass = venue.passes.id(passId);
        if (!pass) {
            throw createError.notFound(ERROR_CODES.NOT_FOUND, 'Pass not found');
        }

        if (enabled && (typeof amount !== 'number' || amount < 0)) {
            throw createError.validation(
                ERROR_CODES.INVALID_INPUT,
                'Service fee amount must be a non-negative number'
            );
        }

        pass.serviceFee = {
            enabled,
            amount: enabled ? amount : 0
        };

        await venue.save();
        emitVenueUpdate(venueId, 'serviceFeeUpdated', { passId, serviceFee: pass.serviceFee });
        return pass;
    }

    static async updatePassMessages(venueId, passId, messages) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw createError.notFound(ERROR_CODES.VENUE_NOT_FOUND, 'Venue not found');
        }

        const pass = venue.passes.id(passId);
        if (!pass) {
            throw createError.notFound(ERROR_CODES.NOT_FOUND, 'Pass not found');
        }

        Object.assign(pass, messages);
        await venue.save();

        emitVenueUpdate(venueId, 'passUpdated', { passId });
        return pass;
    }
}

module.exports = VenueManagementService; 