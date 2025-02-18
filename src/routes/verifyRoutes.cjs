const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Order = require('../models/Order'); // Added Order model
const MenuItem = mongoose.model('MenuItem');
const Venue = require('../models/Venue'); // Added Venue model

// Only the basic verify endpoint
router.get('/:passId', (req, res) => {
    const securityCode = req.params.passId.slice(0,6).toUpperCase();
    
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400');
    res.setHeader('Content-Type', 'text/html');
    res.send(`
        <!DOCTYPE html>
        <html>
            <body style="background:#141414;color:white;text-align:center;padding:20px;font-family:system-ui;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center">
                <div style="background:rgba(255,255,255,0.1);padding:30px;border-radius:12px;max-width:300px;width:100%">
                    <h2 style="margin:0 0 20px">FOMO Entry Pass</h2>
                    <div style="font-size:24px;margin:20px">
                        <div>🎫 Valid Until 6AM</div>
                        <div style="color:#00ff00;font-size:48px;margin:20px 0">✓</div>
                    </div>
                    <div style="opacity:0.7;font-size:18px">
                        Security Code: ${securityCode}
                    </div>
                </div>
            </body>
        </html>
    `);
});

// Add drink order verification endpoint
router.get('/drink/:orderId', async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId)
            .populate('items.menuItem')
            .populate('venueId', 'name');

        if (!order) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                    <body style="background:#141414;color:white;text-align:center;padding:20px;font-family:system-ui;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center">
                        <div style="background:rgba(255,255,255,0.1);padding:30px;border-radius:12px;max-width:300px;width:100%">
                            <h2 style="margin:0 0 20px">Order Not Found</h2>
                            <div style="font-size:24px;margin:20px">
                                <div>❌ Invalid Order ID</div>
                            </div>
                            <div style="opacity:0.7;font-size:14px">
                                Please check your order details and try again.
                            </div>
                        </div>
                    </body>
                </html>
            `);
        }

        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400');
        res.setHeader('Content-Type', 'text/html');
        res.send(`
            <!DOCTYPE html>
            <html>
                <body style="background:#141414;color:white;text-align:center;padding:20px;font-family:system-ui;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center">
                    <div style="background:rgba(255,255,255,0.1);padding:30px;border-radius:12px;max-width:300px;width:100%">
                        <h2 style="margin:0 0 20px">FOMO Drink Order</h2>
                        <div style="font-size:24px;margin:20px">
                            <div>Order #${order.orderNumber}</div>
                            <div style="margin:20px 0">
                                ${order.items.map(item => 
                                    `${item.quantity}x ${item.menuItem.name}`
                                ).join('<br>')}
                            </div>
                            <div style="color:#00ff00;font-size:48px;margin:20px 0">✓</div>
                        </div>
                        <div style="opacity:0.7;font-size:14px">
                            ${new Date(order.createdAt).toLocaleString()}
                        </div>
                    </div>
                </body>
            </html>
        `);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;






