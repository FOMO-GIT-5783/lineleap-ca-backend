const mongoose = require('mongoose');
const { DAYS_SHORT } = require('../utils/dateFormatter.cjs');

// Schema for customization options
const customizationOptionSchema = new mongoose.Schema({
    name: { type: String, required: true },
    choices: [{
        name: { type: String, required: true },
        price: { type: Number, required: true },
        default: { type: Boolean, default: false }
    }]
});

// Schema for drink categories
const drinkCategorySchema = new mongoose.Schema({
    venueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Venue',
        required: true
    },
    name: { type: String, required: true },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true }
});

// Schema for menu items
const menuItemSchema = new mongoose.Schema({
    venueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Venue',
        required: true
    },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    dailyPricing: [{
        day: { 
            type: String, 
            enum: DAYS_SHORT,
            required: true
        },
        price: Number,
        available: { type: Boolean, default: true },
        active: { type: Boolean, default: true }
        
    }],
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DrinkCategory',
        required: true
    },
    isPopular: { type: Boolean, default: false },
    orderCount: { type: Number, default: 0 },
    lastOrdered: Date,
    thumbnail: String,
    image: String,
    description: String,
    customization: [customizationOptionSchema],
    available: { type: Boolean, default: true },
    preparationTime: { type: Number, default: 5 },
    sortOrder: Number,
    baseOptions: {
        type: [{
            name: String,
            price: Number
        }],
        default: []
    },
    mixers: {
        type: [{
            name: String,
            price: Number
        }],
        default: []
    }
});

// Define all indexes in one place
menuItemSchema.index({ venueId: 1 });
menuItemSchema.index({ name: 1, venueId: 1 }, { unique: true });
menuItemSchema.index({ name: 1, venueId: 1, category: 1 }, { unique: true });

// Pre-save middleware for duplicates
menuItemSchema.pre('save', async function(next) {
    if (this.isNew) {
        const existing = await this.constructor.findOne({
            name: this.name,
            venueId: this.venueId
        });

        if (existing) {
            existing.price = this.price;
            existing.description = this.description;
            existing.available = this.available;
            existing.category = this.category;
            await existing.save();
            return next(new Error('Item exists - updated existing'));
        }
    }
    next();
});

// Create models if they don't exist
const DrinkCategory = mongoose.models.DrinkCategory || mongoose.model('DrinkCategory', drinkCategorySchema);
const MenuItem = mongoose.models.MenuItem || mongoose.model('MenuItem', menuItemSchema);

// Add static methods to MenuItem schema
menuItemSchema.statics.findOneAndUpdate = async function(conditions, update, options) {
    const doc = await this.findOne(conditions);
    if (!doc) {
        return null;
    }
    Object.assign(doc, update);
    return doc.save(options);
};

// Export the models
module.exports = {
    MenuItem,
    DrinkCategory
};





