const { Parser } = require('json2csv');
const AnalyticsAggregator = require('./aggregator');

class ReportGenerator {
    static async generateVenueReport(venueId, startDate, endDate, format = 'json') {
        const data = await AnalyticsAggregator.getVenueOverview(venueId, startDate, endDate);
        
        if (format === 'csv') {
            return this.convertToCSV(data);
        }
        
        return data;
    }

    static async generateHourlyReport(venueId, date, format = 'json') {
        const data = await AnalyticsAggregator.getHourlyMetrics(venueId, date);
        
        if (format === 'csv') {
            return this.convertToCSV(data);
        }
        
        return data;
    }

    static convertToCSV(data) {
        const parser = new Parser({
            flatten: true
        });
        
        return parser.parse(data);
    }
}

module.exports = ReportGenerator; 