const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { requireVenueOwner } = require('../middleware/authMiddleware.cjs');
const { validateVenue } = require('../middleware/validationMiddleware.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const Venue = require('../models/Venue.cjs');
const User = require('../models/User.cjs');
const Order = require('../models/Order.cjs');
const MenuItem = mongoose.model('MenuItem');
const { emitVenueUpdate } = require('../websocket/socketManager.cjs');
const { getCurrentDay } = require('../utils/dateFormatter.cjs');

// Get all venues managed by owner
router.get('/venues', requireVenueOwner(), async (req, res) => {
    try {
        const venues = await Venue.find({
            _id: { $in: req.user.managedVenues }
        });
        res.json(venues);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fix for Owner Route: Fetch a single managed venue
router.get('/venues/:venueId', requireVenueOwner(), async (req, res) => {
    try {
        const venue = await Venue.findOne({
            _id: req.params.venueId,
            _id: { $in: req.user.managedVenues }
        });
        if (!venue) return res.status(404).json({ error: 'Venue not found or not authorized' });
        res.json(venue);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update venue operating hours
router.patch('/venues/:venueId/hours', requireVenueOwner(), async (req, res) => {
    try {
        const { venueId } = req.params;
        const { open, close, daysOpen } = req.body;

        const venue = await Venue.findOneAndUpdate(
            { _id: venueId, _id: { $in: req.user.managedVenues } },
            {
                'operatingHours.open': open,
                'operatingHours.close': close,
                'operatingHours.daysOpen': daysOpen
            },
            { new: true }
        );

        if (!venue) return res.status(404).json({ error: 'Venue not found or not managed by user' });

        emitVenueUpdate(venue._id, 'hoursUpdate', venue.operatingHours);
        res.json(venue);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Get pass visibility for a specific venue
router.get('/venues/:venueId/passes', requireVenueOwner(), async (req, res) => {
    try {
        const venue = await Venue.findById(req.params.venueId);
        if (!venue) {
            return res.status(404).json({ error: 'Venue not found' });
        }

        res.json({
            schedule: venue.passes.schedule,
            visibility: venue.passes.visibility,
            serviceFee: venue.passes.serviceFee,
            price: venue.passes.price,
            available: venue.passes.available,
            customQuestions: venue.passes.customQuestions,
            instructions: venue.passes.instructions,
            startMessage: venue.passes.startMessage
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add venue and drink prices update endpoint
router.patch('/venues/:venueId/prices', requireVenueOwner(), async (req, res) => {
    try {
        const { passPrice, drinkPrices } = req.body;
        
        // Update venue pass price
        if (passPrice) {
            await Venue.findByIdAndUpdate(
                req.params.venueId,
                { 'passes.price': passPrice }
            );
        }

        // Bulk update drink prices
        if (Array.isArray(drinkPrices) && drinkPrices.length) {
            const bulkOperations = drinkPrices.map(({ itemId, price }) => ({
                updateOne: {
                    filter: { 
                        _id: itemId,
                        venueId: req.params.venueId 
                    },
                    update: { price }
                }
            }));

            await MenuItem.bulkWrite(bulkOperations);
        }

        emitVenueUpdate(req.params.venueId, 'priceUpdate', {
            timestamp: new Date()
        });

        res.json({ message: 'Prices updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Schedule Management
router.put('/venues/:venueId/passes/schedule', requireVenueOwner(), async (req, res) => {
    try {
        console.log('Schedule Update Request:', {
            venueId: req.params.venueId,
            newSchedule: req.body
        });

        // Validate owner access
        if (!req.user?.managedVenues?.includes(req.params.venueId)) {
            return res.status(403).json({
                error: 'Not authorized',
                user: req.user?._id,
                managedVenues: req.user?.managedVenues
            });
        }

        const { type, daysAvailable } = req.body;

        const venue = await Venue.findOneAndUpdate(
            { _id: req.params.venueId },
            {
                'passes.schedule': {
                    type,
                    daysAvailable
                }
            },
            { new: true }
        );

        if (!venue) {
            return res.status(404).json({ error: 'Venue not found' });
        }

        // Emit update
        emitVenueUpdate(venue._id, 'scheduleUpdate', venue.passes.schedule);

        res.json(venue.passes.schedule);
    } catch (err) {
        console.error('Schedule update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Service Fee Management
router.put('/venues/:venueId/passes/service-fee', requireVenueOwner(), async (req, res) => {
    try {
        const { enabled, amount } = req.body;

        if (amount < 0) {
            return res.status(400).json({ error: 'Invalid service fee amount' });
        }

        const venue = await Venue.findByIdAndUpdate(
            req.params.id,
            {
                'passes.serviceFee': { enabled, amount }
            },
            { new: true }
        );

        emitVenueUpdate(venue._id, 'serviceFeeUpdate', venue.passes.serviceFee);

        res.json(venue);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update pass details
router.put('/venues/:venueId/passes/details', requireVenueOwner(), async (req, res) => {
    try {
        const { instructions, customQuestions, startMessage } = req.body;
        
        const venue = await Venue.findByIdAndUpdate(
            req.params.venueId,
            {
                'passes.instructions': instructions,
                'passes.customQuestions': customQuestions,
                'passes.startMessage': startMessage
            },
            { new: true }
        );

        emitVenueUpdate(venue._id, 'passDetailsUpdate', {
            instructions: venue.passes.instructions,
            customQuestions: venue.passes.customQuestions,
            startMessage: venue.passes.startMessage
        });

        res.json(venue.passes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle menu item availability per day
router.put('/venues/:venueId/menu/:itemId/availability', requireVenueOwner(), async (req, res) => {
    try {
        const { day, active } = req.body;
        
        const menuItem = await MenuItem.findById(req.params.itemId);
        const dayPricing = menuItem.dailyPricing.find(p => p.day === day);
        
        if (dayPricing) {
            dayPricing.active = active;
            await menuItem.save();
        }

        emitVenueUpdate(req.params.venueId, 'menuItemUpdate', {
            itemId: menuItem._id,
            day,
            active
        });

        res.json(menuItem);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Add passes to a venue
router.post('/venues/:venueId/passes', requireVenueOwner(), async (req, res) => {
    try {
        const venue = await Venue.findByIdAndUpdate(
            req.params.venueId,
            {
                'passes.schedule': req.body.schedule,
                'passes.name': req.body.name,
                'passes.type': req.body.type
            },
            { new: true }
        );
        
        if (!venue) {
            return res.status(404).json({ error: 'Venue not found' });
        }
        
        res.json(venue);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Drink Ordering Settings Management
router.put('/venues/:venueId/drink-settings', requireVenueOwner(), async (req, res) => {
    try {
        const { active, serviceFee, tipping } = req.body;

        const venue = await Venue.findByIdAndUpdate(
            req.params.venueId,
            {
                'drinkOrdering.active': active,
                'drinkOrdering.serviceFee': serviceFee,
                'drinkOrdering.tipping': tipping
            },
            { new: true }
        );

        emitVenueUpdate(venue._id, 'drinkSettingsUpdate', venue.drinkOrdering);
        res.json(venue.drinkOrdering);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;







