const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const rateLimit = require('express-rate-limit');
const OrderMetrics = require('../models/OrderMetrics.cjs');
const OrderMetricsService = require('../services/orderMetricsService.cjs');
const { requireVenueOwner } = require('../middleware/authMiddleware.cjs');
const { validateDateRange } = require('../utils/validators.cjs');
const Venue = require('../models/Venue.cjs');

// Rate limiting configuration
const dashboardLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

const exportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10 // limit each IP to 10 exports per hour
});

// Middleware to validate venue ownership
const validateVenueOwnership = async (req, res, next) => {
    try {
        const venue = await Venue.findById(req.params.venueId);
        if (!venue || venue.ownerId.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Unauthorized access to venue dashboard' });
        }
        req.venue = venue;
        next();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Apply rate limiting to all dashboard routes
router.use(dashboardLimiter);

// Get real-time dashboard data
router.get('/venue/:venueId/realtime', 
    requireVenueOwner, 
    validateVenueOwnership,
    async (req, res) => {
    try {
        const realtimeData = await OrderMetricsService.getRealTimeMetrics(req.params.venueId);
        
        res.json({
            status: 'success',
            data: {
                ...realtimeData,
                lastUpdated: new Date()
            }
        });
    } catch (error) {
        console.error('Dashboard Realtime Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get historical dashboard data with enhanced metrics
router.get('/venue/:venueId/historical',
    requireVenueOwner,
    validateVenueOwnership,
    async (req, res) => {
    try {
        const { venueId } = req.params;
        const { startDate, endDate } = req.query;

        // Validate date range
        const validatedDates = validateDateRange(startDate, endDate, 90); // Max 90 days range
        if (!validatedDates.isValid) {
            return res.status(400).json({ error: validatedDates.error });
        }

        const [metrics, averages, topItems] = await Promise.all([
            OrderMetricsService.getVenueMetrics(venueId, {
                startDate: validatedDates.startDate,
                endDate: validatedDates.endDate
            }),
            OrderMetricsService.calculateAverages(venueId, 
                validatedDates.startDate,
                validatedDates.endDate
            ),
            OrderMetricsService.getTopItems(venueId, 5)
        ]);

        res.json({
            status: 'success',
            data: {
                ...metrics,
                averages: averages[0],
                topItems,
                period: {
                    start: validatedDates.startDate,
                    end: validatedDates.endDate
                }
            }
        });
    } catch (error) {
        console.error('Dashboard Historical Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get calendar data
router.get('/venue/:venueId/calendar',
    requireVenueOwner,
    validateVenueOwnership,
    async (req, res) => {
    try {
        const { venueId } = req.params;
        const { month, year } = req.query;
        
        // Validate month and year
        const currentYear = new Date().getFullYear();
        if (!month || !year || 
            month < 1 || month > 12 || 
            year < currentYear - 1 || year > currentYear) {
            return res.status(400).json({ 
                error: 'Invalid month or year. Must be within the last year.' 
            });
        }

        const calendarData = await OrderMetricsService.getCalendarData(
            venueId,
            parseInt(month),
            parseInt(year)
        );

        res.json({
            status: 'success',
            data: calendarData
        });
    } catch (error) {
        console.error('Calendar Data Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get transaction data with filters
router.get('/venue/:venueId/transactions',
    requireVenueOwner,
    validateVenueOwnership,
    async (req, res) => {
    try {
        const { venueId } = req.params;
        const { startDate, endDate, orderType } = req.query;

        // Validate date range
        const validatedDates = validateDateRange(startDate, endDate, 30); // Max 30 days for transactions
        if (!validatedDates.isValid) {
            return res.status(400).json({ error: validatedDates.error });
        }

        const transactions = await OrderMetricsService.getTransactionData(
            venueId,
            validatedDates.startDate,
            validatedDates.endDate,
            { orderType }
        );

        res.json({
            status: 'success',
            data: transactions
        });
    } catch (error) {
        console.error('Transaction Data Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export transactions
router.get('/venue/:venueId/export',
    requireVenueOwner,
    validateVenueOwnership,
    exportLimiter,
    async (req, res) => {
    try {
        const { venueId } = req.params;
        const { format = 'excel', startDate, endDate } = req.query;

        // Validate date range
        const validatedDates = validateDateRange(startDate, endDate, 90); // Max 90 days for exports
        if (!validatedDates.isValid) {
            return res.status(400).json({ error: validatedDates.error });
        }

        const result = await OrderMetricsService.exportTransactions(
            venueId,
            validatedDates.startDate,
            validatedDates.endDate,
            format
        );

        if (format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=transactions-${venueId}-${new Date().toISOString().split('T')[0]}.xlsx`);
            await result.xlsx.write(res);
        } else {
            res.json({
                status: 'success',
                data: result
            });
        }
    } catch (error) {
        console.error('Export Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get revenue breakdown
router.get('/venue/:venueId/revenue',
    requireVenueOwner,
    validateVenueOwnership,
    async (req, res) => {
    try {
        const { venueId } = req.params;
        const { period = 'day' } = req.query;

        // Validate period
        const validPeriods = ['day', 'week', 'month', 'year'];
        if (!validPeriods.includes(period)) {
            return res.status(400).json({ 
                error: 'Invalid period. Must be one of: day, week, month, year' 
            });
        }

        const startDate = new Date();
        switch (period) {
            case 'week':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'month':
                startDate.setMonth(startDate.getMonth() - 1);
                break;
            case 'year':
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
            default:
                startDate.setHours(0, 0, 0, 0);
        }

        const metrics = await OrderMetricsService.getVenueMetrics(venueId, {
            startDate,
            endDate: new Date()
        });

        res.json({
            status: 'success',
            data: {
                salesMetrics: metrics.salesMetrics,
                period: {
                    start: startDate,
                    end: new Date()
                }
            }
        });
    } catch (error) {
        console.error('Revenue Breakdown Error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 
