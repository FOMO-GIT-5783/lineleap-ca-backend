const { getCurrentDay } = require('./dateFormatter.cjs');

/**
 * Halifax-specific peak time logic
 * Peak times are Friday and Saturday nights from 10 PM to 2 AM
 */
function isPeakTime() {
    const hour = new Date().getHours();
    const day = getCurrentDay('short');
    return ['Fri', 'Sat'].includes(day) && (hour >= 22 || hour <= 2);
}

/**
 * Get current Halifax venue window information
 */
function getVenueWindow() {
    const day = getCurrentDay('short');
    return {
        isPeak: isPeakTime(),
        windowType: ['Fri', 'Sat'].includes(day) ? 'weekend' : 'weekday'
    };
}

module.exports = {
    isPeakTime,
    getVenueWindow
}; 