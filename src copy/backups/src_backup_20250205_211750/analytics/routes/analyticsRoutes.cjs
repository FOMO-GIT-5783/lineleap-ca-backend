const express = require('express');
const router = express.Router();
const { requireVenueOwner } = require('../../middleware/authMiddleware.cjs');
const AnalyticsAggregator = require('../services/aggregator.cjs');
const { generateCSV } = require('../services/csvGenerator.cjs');

// Basic revenue overview for V1
router.get('/overview/:venueId', requireVenueOwner(), async (req, res) => {
    try {
        const { timeframe = 'day' } = req.query;
        const stats = await AnalyticsAggregator.getRevenueStats(
            req.params.venueId, 
            timeframe
        );
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Simple revenue report export for V1
router.get('/reports/:venueId/export', requireVenueOwner(), async (req, res) => {
    try {
        const { format = 'json', startDate, endDate } = req.query;
        const data = await AnalyticsAggregator.getTransactionData(
            req.params.venueId,
            startDate,
            endDate
        );

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=revenue_report_${req.params.venueId}.csv`);
            const csvData = await generateCSV(data);
            res.send(csvData);
        } else {
            res.json(data);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
