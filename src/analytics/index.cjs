const express = require('express');
const router = express.Router();
const analyticsRoutes = require('./routes/analyticsRoutes.cjs');

router.use('/', analyticsRoutes);

module.exports = router;