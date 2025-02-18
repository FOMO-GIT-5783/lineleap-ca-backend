const express = require('express');
const router = express.Router();
const { requireVenueOwner } = require('../middleware/authMiddleware.cjs');
const OrderMetricsService = require('../services/orderMetricsService.cjs');
const { validateDateRange } = require('../utils/validators.cjs');
const logger = require('../utils/logger.cjs');

// Get venue metrics
router.get('/venue/:venueId/metrics', requireVenueOwner(), async (req, res) => {
    try {
        const { venueId } = req.params;
        const { startDate, endDate } = req.query;
        
        // Validate date range if provided
        let dateRange;
        if (startDate && endDate) {
            dateRange = validateDateRange(startDate, endDate);
        }

        const metrics = await OrderMetricsService.getVenueMetrics(venueId, dateRange);
        res.json({ status: 'success', data: metrics });
    } catch (error) {
        logger.error('Error fetching venue metrics:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Failed to fetch venue metrics'
        });
    }
});

// Get real-time metrics
router.get('/venue/:venueId/realtime', requireVenueOwner(), async (req, res) => {
    try {
        const { venueId } = req.params;
        const metrics = await OrderMetricsService.getRealTimeMetrics(venueId);
        res.json({ status: 'success', data: metrics });
    } catch (error) {
        logger.error('Error fetching real-time metrics:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Failed to fetch real-time metrics'
        });
    }
});

// Get peak hours analysis
router.get('/venue/:venueId/peak-hours', requireVenueOwner(), async (req, res) => {
    try {
        const { venueId } = req.params;
        const { startDate, endDate } = req.query;
        
        // Validate date range
        const dateRange = validateDateRange(startDate, endDate);
        const peakHours = await OrderMetricsService.getPeakHoursAnalysis(venueId, dateRange);
        res.json({ status: 'success', data: peakHours });
    } catch (error) {
        logger.error('Error fetching peak hours analysis:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Failed to fetch peak hours analysis'
        });
    }
});

// Export venue metrics
router.get('/venue/:venueId/export', requireVenueOwner(), async (req, res) => {
    try {
        const { venueId } = req.params;
        const { startDate, endDate, format = 'json' } = req.query;
        
        // Validate date range
        const dateRange = validateDateRange(startDate, endDate);
        const metrics = await OrderMetricsService.exportVenueMetrics(venueId, dateRange, format);
        
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=venue_metrics_${venueId}.csv`);
        }
        
        res.send(metrics);
    } catch (error) {
        logger.error('Error exporting venue metrics:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Failed to export venue metrics'
        });
    }
});

module.exports = router; 