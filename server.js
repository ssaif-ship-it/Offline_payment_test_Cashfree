const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();

// Middleware to capture raw payload for Webhook signature verification
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(cors());
// A simple health-check route for your main URL
// Add this instead:
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
const { CF_CLIENT_ID, CF_CLIENT_SECRET, CF_ENVIRONMENT, CF_API_VERSION, PORT } = process.env;

const cfHeaders = {
    'x-client-id': CF_CLIENT_ID,
    'x-client-secret': CF_CLIENT_SECRET,
    'x-api-version': CF_API_VERSION,
    'Content-Type': 'application/json'
};

// ---------------------------------------------------------
// REAL-TIME EVENTS (SSE) SETUP
// ---------------------------------------------------------
let connectedClients = [];

// Frontend connects here to listen for webhook updates
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    connectedClients.push(res);

    req.on('close', () => {
        connectedClients = connectedClients.filter(client => client !== res);
    });
});

// Broadcast payment status to all connected frontend clients
const notifyFrontend = (orderId, status) => {
    connectedClients.forEach(client => {
        client.write(`data: ${JSON.stringify({ orderId, status })}\n\n`);
    });
};

// ---------------------------------------------------------
// 1. DYNAMIC QR API 
// ---------------------------------------------------------
app.post('/api/dynamic-qr', async (req, res) => {
    try {
        const { amount } = req.body;
        const orderId = `order_${Date.now()}`;

        const orderPayload = {
            order_id: orderId,
            order_amount: Number(amount), // Cast to Number to prevent 'api Request Failed'
            order_currency: 'INR',
            customer_details: {
                customer_id: 'walk_in_customer',
                customer_phone: '9999999999'
            }
        };

        const orderRes = await axios.post(`${CF_ENVIRONMENT}/orders`, orderPayload, { headers: cfHeaders });
        const paymentSessionId = orderRes.data.payment_session_id;

        const sessionPayload = {
            payment_session_id: paymentSessionId,
            payment_method: { upi: { channel: "qrcode" } }
        };

        const sessionRes = await axios.post(`${CF_ENVIRONMENT}/orders/sessions`, sessionPayload, { headers: cfHeaders });
        
        res.json({ success: true, orderId, qrCode: sessionRes.data.data.payload.qrcode });
    } catch (error) {
        console.error("Dynamic QR Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.response?.data?.message || error.message });
    }
});

// ---------------------------------------------------------
// 2. SOFTPOS PUSH API
// ---------------------------------------------------------
app.post('/api/softpos', async (req, res) => {
    try {
        const { amount, terminalPhone } = req.body;
        const orderId = `order_pos_${Date.now()}`;

        const orderPayload = {
            order_id: orderId,
            order_amount: Number(amount), // Cast to Number to prevent 'api Request Failed'
            order_currency: 'INR',
            customer_details: {
                customer_id: 'walk_in_customer',
                customer_phone: '9999999999'
            },
            terminal_details: {
                terminal_phone_no: terminalPhone 
            }
        };

        const orderRes = await axios.post(`${CF_ENVIRONMENT}/orders`, orderPayload, { headers: cfHeaders });
        const cfOrderId = orderRes.data.cf_order_id; 

        const transactionPayload = {
            cf_order_id: cfOrderId,
            payment_method: "upi", 
            terminal_phone_no: terminalPhone
        };

        await axios.post(`${CF_ENVIRONMENT}/terminal/transactions`, transactionPayload, { headers: cfHeaders });
        
        res.json({ success: true, message: "Transaction pushed to agent device successfully." });
    } catch (error) {
        console.error("SoftPOS Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.response?.data?.message || error.message });
    }
});

// ---------------------------------------------------------
// 3. STATIC QR API 
// ---------------------------------------------------------
app.get('/api/static-qr/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        
        // In Sandbox, fetching from Cashfree's terminal/qrcodes endpoint often fails
        // due to incomplete KYC on test terminals. We generate a robust test QR directly.
        // For production, you will use your assigned terminal VPA instead of 'success@upi'.
        const vpa = 'success@upi'; 
        
        const upiIntent = `upi://pay?pa=${vpa}&pn=Store_Terminal_${phone}&cu=INR`;
        const qrCodeBase64 = await QRCode.toDataURL(upiIntent);
        
        res.json({ success: true, qrCode: qrCodeBase64, vpa: vpa });
    } catch (error) {
        console.error("Static QR Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.response?.data?.message || error.message });
    }
});

// ---------------------------------------------------------
// 4. WEBHOOK HANDLER
// ---------------------------------------------------------
app.post('/cashfree-webhook', (req, res) => {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const rawBody = req.rawBody;

    try {
        const expectedSignature = crypto
            .createHmac('sha256', CF_CLIENT_SECRET)
            .update(timestamp + rawBody)
            .digest('base64');

        if (expectedSignature === signature) {
            console.log("✅ Webhook Verified!");
            
            const payload = JSON.parse(rawBody);
            const orderId = payload.data.order.order_id;
            const status = payload.data.payment.payment_status;

            console.log(`Order ${orderId} status: ${status}`);
            
            // Push success notification to the frontend real-time via SSE
            if (status === 'SUCCESS') {
                notifyFrontend(orderId, 'SUCCESS');
            }

            res.status(200).send('OK');
        } else {
            console.error("❌ Webhook verification failed: Signature mismatch.");
            res.status(403).send('Forbidden');
        }
    } catch (error) {
        console.error("Webhook processing error:", error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(PORT || 3000, () => console.log(`Server running on http://localhost:${PORT || 3000}`));
