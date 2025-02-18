const express = require('express');
const router = express.Router();
const VenueManagementService = require('../services/venueManagementService.cjs');
const { requireVenueOwner } = require('../middleware/authMiddleware.cjs');
const { validateVenue, validateSchedule } = require('../middleware/validationMiddleware.cjs');

// Pass Management Routes
// =====================

// Create/Update Passes
router.post('/:venueId/passes',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId } = req.params;
            const pass = await VenueManagementService.addPass(venueId, req.body);
            res.json({ status: 'success', data: pass });
        } catch (error) {
            next(error);
        }
    }
);

router.patch('/:venueId/passes/:passId',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId, passId } = req.params;
            const pass = await VenueManagementService.updatePassSettings(venueId, passId, req.body);
            res.json({ status: 'success', data: pass });
        } catch (error) {
            next(error);
        }
    }
);

// Pass Schedule Management
router.patch('/:venueId/passes/:passId/schedule',
    requireVenueOwner(),
    validateSchedule,
    async (req, res, next) => {
        try {
            const { venueId, passId } = req.params;
            const pass = await VenueManagementService.updatePassSchedule(venueId, passId, req.body);
            res.json({ status: 'success', data: pass });
        } catch (error) {
            next(error);
        }
    }
);

router.post('/:venueId/blackout-dates',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId } = req.params;
            const { dates, operation } = req.body;
            const blackoutDates = await VenueManagementService.manageBlackoutDates(
                venueId,
                dates.map(d => new Date(d)),
                operation
            );
            res.json({ status: 'success', data: blackoutDates });
        } catch (error) {
            next(error);
        }
    }
);

// Pass Settings
router.patch('/:venueId/passes/:passId/status',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId, passId } = req.params;
            const { status } = req.body;
            const pass = await VenueManagementService.updatePassStatus(venueId, passId, status);
            res.json({ status: 'success', data: pass });
        } catch (error) {
            next(error);
        }
    }
);

router.patch('/:venueId/passes/:passId/service-fee',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId, passId } = req.params;
            const pass = await VenueManagementService.updatePassServiceFee(venueId, passId, req.body);
            res.json({ status: 'success', data: pass });
        } catch (error) {
            next(error);
        }
    }
);

router.patch('/:venueId/passes/:passId/messages',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId, passId } = req.params;
            const pass = await VenueManagementService.updatePassMessages(venueId, passId, req.body);
            res.json({ status: 'success', data: pass });
        } catch (error) {
            next(error);
        }
    }
);

// Drink Menu Management Routes
// ==========================

// Categories
router.post('/:venueId/categories',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId } = req.params;
            const category = await VenueManagementService.addDrinkCategory(venueId, req.body);
            res.json({ status: 'success', data: category });
        } catch (error) {
            next(error);
        }
    }
);

router.patch('/:venueId/categories/:categoryId',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId, categoryId } = req.params;
            const category = await VenueManagementService.updateDrinkCategory(venueId, categoryId, req.body);
            res.json({ status: 'success', data: category });
        } catch (error) {
            next(error);
        }
    }
);

router.post('/:venueId/categories/reorder',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId } = req.params;
            const { categoryOrder } = req.body;
            const categories = await VenueManagementService.reorderCategories(venueId, categoryOrder);
            res.json({ status: 'success', data: categories });
        } catch (error) {
            next(error);
        }
    }
);

// Drinks
router.post('/:venueId/categories/:categoryId/drinks',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId, categoryId } = req.params;
            const drink = await VenueManagementService.addDrink(venueId, categoryId, req.body);
            res.json({ status: 'success', data: drink });
        } catch (error) {
            next(error);
        }
    }
);

router.patch('/:venueId/drinks/:drinkId',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId, drinkId } = req.params;
            const drink = await VenueManagementService.updateDrink(venueId, drinkId, req.body);
            res.json({ status: 'success', data: drink });
        } catch (error) {
            next(error);
        }
    }
);

router.patch('/:venueId/drinks/:drinkId/pricing',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId, drinkId } = req.params;
            const drink = await VenueManagementService.updateDrinkPricing(venueId, drinkId, req.body);
            res.json({ status: 'success', data: drink });
        } catch (error) {
            next(error);
        }
    }
);

// Venue Settings Routes
// ===================

// Drink Ordering Settings
router.patch('/:venueId/drink-ordering',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId } = req.params;
            const venue = await VenueManagementService.updateDrinkOrdering(venueId, req.body);
            res.json({ status: 'success', data: venue });
        } catch (error) {
            next(error);
        }
    }
);

router.patch('/:venueId/service-fee',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId } = req.params;
            const venue = await VenueManagementService.updateServiceFee(venueId, req.body);
            res.json({ status: 'success', data: venue });
        } catch (error) {
            next(error);
        }
    }
);

router.patch('/:venueId/tipping',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId } = req.params;
            const drinkOrdering = await VenueManagementService.updateTippingOptions(venueId, req.body);
            res.json({ status: 'success', data: drinkOrdering });
        } catch (error) {
            next(error);
        }
    }
);

router.patch('/:venueId/operating-hours',
    requireVenueOwner(),
    async (req, res, next) => {
        try {
            const { venueId } = req.params;
            const venue = await VenueManagementService.updateOperatingHours(venueId, req.body);
            res.json({ status: 'success', data: venue });
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router; 