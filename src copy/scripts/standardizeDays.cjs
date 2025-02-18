const mongoose = require('mongoose');
const Venue = mongoose.model('Venue');  // Get existing model
const { convertDayFormat } = require('../utils/dateFormatter.cjs');

async function standardizeDays() {
    console.log('Starting migration...');
    try {
        const venues = await Venue.find();
        console.log(`Found ${venues.length} venues`);
        
        for (const venue of venues) {
            console.log('Processing venue:', venue._id);
            if (venue.passes?.schedule?.daysAvailable) {
                const oldDays = [...venue.passes.schedule.daysAvailable];
                venue.passes.schedule.daysAvailable = 
                    oldDays.map(day => convertDayFormat(day, 'short'));
                
                console.log('Updated days:', {
                    venueId: venue._id,
                    before: oldDays,
                    after: venue.passes.schedule.daysAvailable
                });
                
                await venue.save();
            }
        }
        console.log('Migration completed successfully');
    } catch (err) {
        console.error('Migration Error:', err);
        throw err;
    }
}

module.exports = { standardizeDays };