const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getCurrentDay(format = 'short') {
    const day = new Date().getDay();
    return format === 'short' ? DAYS_SHORT[day] : DAYS_LONG[day];
}

function convertDayFormat(day, toFormat = 'short') {
    if (toFormat === 'short') {
        const index = DAYS_LONG.indexOf(day);
        return index > -1 ? DAYS_SHORT[index] : day;
    }
    const index = DAYS_SHORT.indexOf(day);
    return index > -1 ? DAYS_LONG[index] : day;
}

module.exports = { getCurrentDay, convertDayFormat, DAYS_SHORT, DAYS_LONG };