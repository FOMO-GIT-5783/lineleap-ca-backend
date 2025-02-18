const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { requireVenueOwner } = require('../middleware/authMiddleware.cjs');
const MenuItem = mongoose.model('MenuItem');
const Venue = require('../models/Venue.cjs');
const DrinkCategory = mongoose.model('DrinkCategory');
const { emitVenueUpdate } = require('../websocket/socketManager.cjs');
const { getCurrentDay } = require('../utils/dateFormatter.cjs');

// Get venue's menu
router.get('/:venueId/menu', requireVenueOwner(), async (req, res) => {
    try {
        const menu = await MenuItem.find({ venueId: req.params.venueId })
            .sort({ category: 1, sortOrder: 1 });
        res.json(menu);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add menu item
router.post('/:venueId/menu', requireVenueOwner(), async (req, res) => {
    try {
        const existingItem = await MenuItem.findOne({
            venueId: req.params.venueId,
            name: req.body.name
        });

        if (existingItem) {
            // Update existing item instead of creating a new one
            const item = await MenuItem.findByIdAndUpdate(
                existingItem._id,
                {
                    ...req.body,
                    orderCount: Math.max(existingItem.orderCount || 0, req.body.orderCount || 0),
                    lastOrdered: existingItem.lastOrdered || req.body.lastOrdered
                },
                { new: true }
            );
            return res.status(200).json(item);
        }

        const item = new MenuItem({
            ...req.body,
            venueId: req.params.venueId
        });
        await item.save();

        emitVenueUpdate(req.params.venueId, 'menuUpdate', {
            type: 'add',
            item
        });

        res.status(201).json(item);
    } catch (err) {
        if (err.code === 11000) { // Duplicate key error
            res.status(409).json({ error: 'Menu item already exists' });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// Update menu item
router.patch('/:venueId/menu/:itemId', requireVenueOwner(), async (req, res) => {
    try {
        const item = await MenuItem.findOneAndUpdate(
            { _id: req.params.itemId, venueId: req.params.venueId },
            req.body,
            { new: true }
        );

        emitVenueUpdate(req.params.venueId, 'menuUpdate', {
            type: 'update',
            item
        });

        res.json(item);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle item availability
router.patch('/:venueId/menu/:itemId/toggle', requireVenueOwner(), async (req, res) => {
    try {
        const item = await MenuItem.findOne({ 
            _id: req.params.itemId, 
            venueId: req.params.venueId 
        });

        item.available = !item.available;
        await item.save();

        emitVenueUpdate(req.params.venueId, 'menuUpdate', {
            type: 'availability',
            itemId: item._id,
            available: item.available
        });

        res.json(item);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete menu item
router.delete('/:venueId/menu/:itemId', requireVenueOwner(), async (req, res) => {
    try {
        await MenuItem.findOneAndDelete({ 
            _id: req.params.itemId, 
            venueId: req.params.venueId 
        });

        emitVenueUpdate(req.params.venueId, 'menuUpdate', {
            type: 'delete',
            itemId: req.params.itemId
        });

        res.json({ message: 'Item deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bulk update menu items order
router.patch('/:venueId/menu/reorder', requireVenueOwner(), async (req, res) => {
    try {
        const { items } = req.body;

        await Promise.all(items.map(({ id, sortOrder }) => 
            MenuItem.updateOne(
                { _id: id, venueId: req.params.venueId },
                { sortOrder }
            )
        ));

        emitVenueUpdate(req.params.venueId, 'menuUpdate', {
            type: 'reorder',
            items
        });

        res.json({ message: 'Menu reordered' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Category Management
router.post('/:venueId/categories', requireVenueOwner(), async (req, res) => {
    try {
        const category = new DrinkCategory({
            venueId: req.params.venueId,
            name: req.body.name,
            sortOrder: req.body.sortOrder
        });
        await category.save();
        emitVenueUpdate(req.params.venueId, 'categoryUpdate', { type: 'add', category });
        res.status(201).json(category);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:venueId/categories/sort', requireVenueOwner(), async (req, res) => {
    try {
        const updates = req.body.categories.map(({ id, sortOrder }) => 
            DrinkCategory.findByIdAndUpdate(id, { sortOrder })
        );
        await Promise.all(updates);
        emitVenueUpdate(req.params.venueId, 'categoryUpdate', { type: 'sort' });
        res.json({ message: 'Categories reordered' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add GET categories route
router.get('/:venueId/menu/categories', requireVenueOwner(), async (req, res) => {
    try {
        const categories = await mongoose.model('DrinkCategory').find({ 
            venueId: req.params.venueId 
        });
        res.json(categories);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Drink Pricing Management
router.put('/:venueId/menu/:itemId/pricing', requireVenueOwner(), async (req, res) => {
    try {
        const { dailyPricing } = req.body;
        const item = await MenuItem.findOneAndUpdate(
            { _id: req.params.itemId, venueId: req.params.venueId },
            { dailyPricing },
            { new: true }
        );
        emitVenueUpdate(req.params.venueId, 'menuUpdate', { type: 'pricing', item });
        res.json(item);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;


