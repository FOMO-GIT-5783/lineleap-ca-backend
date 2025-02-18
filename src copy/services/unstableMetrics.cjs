const mongoose = require('mongoose');

module.exports = {
    record: (type, data) => {
        console.log('Test metrics recording:', { type, data });
        return Promise.resolve({
            type,
            venueId: data.venueId || 'test',
            value: data.value || 1,
            timestamp: data.timestamp || new Date(),
            _test: true
        });
    }
}; 