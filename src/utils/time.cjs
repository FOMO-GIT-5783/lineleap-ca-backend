const { DateTime } = require('luxon');

function isPeakTime() {
    const now = DateTime.now().setZone('America/Halifax');
    return now.weekday >= 5 && (now.hour >= 22 || now.hour < 2);
}

module.exports = {
    isPeakTime
}; 