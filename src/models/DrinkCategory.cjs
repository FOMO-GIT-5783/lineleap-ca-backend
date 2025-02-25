const mongoose = require('mongoose');

const drinkCategorySchema = new mongoose.Schema({
    venueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Venue',
        required: true
    },
    name: { 
        type: String, 
        required: true 
    },
    sortOrder: { 
        type: Number, 
        default: 0 
    },
    active: { 
        type: Boolean, 
        default: true 
    }
});

// Define all indexes in one place
drinkCategorySchema.index({ venueId: 1 });
drinkCategorySchema.index({ sortOrder: 1 });
drinkCategorySchema.index({ venueId: 1, sortOrder: 1 });

// Handle model recompilation
let DrinkCategory;
try {
    DrinkCategory = mongoose.model('DrinkCategory');
} catch (error) {
    DrinkCategory = mongoose.model('DrinkCategory', drinkCategorySchema);
}

module.exports = DrinkCategory;