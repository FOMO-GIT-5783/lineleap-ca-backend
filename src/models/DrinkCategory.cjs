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

// Add index for quick sorting
drinkCategorySchema.index({ venueId: 1, sortOrder: 1 });

// Handle model recompilation
let DrinkCategory;
try {
    DrinkCategory = mongoose.model('DrinkCategory');
} catch (error) {
    DrinkCategory = mongoose.model('DrinkCategory', drinkCategorySchema);
}

module.exports = DrinkCategory;