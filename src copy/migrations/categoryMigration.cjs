const mongoose = require('mongoose');
// Updated imports to use mongoose model
const MenuItem = mongoose.model('MenuItem');
const DrinkCategory = mongoose.model('DrinkCategory');

async function migrateDrinkCategories() {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Check if migration already run
        const existingCategories = await DrinkCategory.countDocuments();
        if (existingCategories > 0) {
            console.log('Migration already completed');
            return;
        }

        // Get all items grouped by venue and category
        const categoriesByVenue = await MenuItem.aggregate([
            {
                $group: {
                    _id: {
                        venueId: '$venueId',
                        category: '$category'
                    },
                    count: { $sum: 1 }
                }
            }
        ]);

        // Batch create categories
        const categoryMappings = [];
        for (const group of categoriesByVenue) {
            const category = await DrinkCategory.create([{
                venueId: group._id.venueId,
                name: group._id.category,
                sortOrder: categoryMappings.length,
                active: true
            }], { session });

            categoryMappings.push({
                venueId: group._id.venueId,
                oldCategory: group._id.category,
                newCategoryId: category[0]._id
            });
        }

        // Batch update items
        await Promise.all(categoryMappings.map(mapping => 
            MenuItem.updateMany(
                { 
                    venueId: mapping.venueId,
                    category: mapping.oldCategory
                },
                { 
                    category: mapping.newCategoryId 
                },
                { session }
            )
        ));

        await session.commitTransaction();
        console.log('Migration completed successfully');
    } catch (err) {
        await session.abortTransaction();
        console.error('Migration failed:', err);
        throw err;
    } finally {
        session.endSession();
    }
}

module.exports = migrateDrinkCategories;


