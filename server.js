require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const QRCode = require('qrcode');
const path = require('path');

const app = express();

// Capture raw body buffer required for Cashfree HMAC signature verification
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(cors());

const { 
    CF_CLIENT_ID, 
    CF_CLIENT_SECRET, 
    CF_WEBHOOK_SECRET, 
    CF_ENVIRONMENT, 
    CF_API_VERSION, 
    PORT 
} = process.env;

const cfHeaders = {
    'x-client-id': CF_CLIENT_ID,
    'x-client-secret': CF_CLIENT_SECRET,
    'x-api-version': CF_API_VERSION,
    'Content-Type': 'application/json'
};

// ---------------------------------------------------------
// 1. SERVE FRONTEND UI
// ---------------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------------------------------------------------------
// 2. REAL-TIME SERVER-SENT EVENTS (SSE) FOR FRONTEND NOTIFICATION
// ---------------------------------------------------------
let connectedClients = [];

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

const notifyFrontend = (orderId, status) => {
    connectedClients.forEach(client => {
        client.write(`data: ${JSON.stringify({ orderId, status })}\n\n`);
    });
};

// ---------------------------------------------------------
// 3. DYNAMIC QR API
// ---------------------------------------------------------
app.post('/api/dynamic-qr', async (req, res) => {
    try {
        const { amount } = req.body;
        const orderId = `order_${Date.now()}`;

        const orderPayload = {
            order_id: orderId,
            order_amount: Number(amount), // Strictly cast to Number to prevent API type mismatch errors
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
// 4. SOFTPOS PUSH API
// ---------------------------------------------------------
app.post('/api/softpos', async (req, res) => {
    try {
        const { amount, terminalPhone } = req.body;
        const orderId = `order_pos_${Date.now()}`;

        const orderPayload = {
            order_id: orderId,
            order_amount: Number(amount),
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
// 5. STATIC QR API
// ---------------------------------------------------------
app.get('/api/static-qr/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        
        const response = await axios.get(`${CF_ENVIRONMENT}/terminals?terminal_phone_no=${phone}`, { headers: cfHeaders });
        
        if (!response.data || response.data.length === 0) {
            return res.status(404).json({ success: false, error: "Terminal not found in Cashfree records." });
        }

        const terminal = response.data[0];
        const vpa = terminal.terminal_vpa;
        
        if (!vpa) {
            return res.status(400).json({ success: false, error: "Terminal exists, but Cashfree has not assigned a VPA to it." });
        }

        const upiIntent = `upi://pay?pa=${vpa}&pn=${terminal.terminal_name || 'Store_Terminal'}&cu=INR`;
        const qrCodeBase64 = await QRCode.toDataURL(upiIntent);
        
        res.json({ success: true, qrCode: qrCodeBase64, vpa: vpa });
    } catch (error) {
        console.error("Static QR Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.response?.data?.message || error.message });
    }
});

// ---------------------------------------------------------
// 6. BULLETPROOF WEBHOOK HANDLER
// ---------------------------------------------------------
app.post('/cashfree-webhook', (req, res) => {
    try {
        const signature = req.headers['x-webhook-signature'];
        const timestamp = req.headers['x-webhook-timestamp'];
        const rawBody = req.rawBody || JSON.stringify(req.body);

        // Verify cryptographic signature if headers are provided
        if (signature && timestamp) {
            const secretKey = CF_WEBHOOK_SECRET || CF_CLIENT_SECRET;
            
            const expectedSignature = crypto
                .createHmac('sha256', secretKey)
                .update(timestamp + rawBody)
                .digest('base64');

            if (expectedSignature !== signature) {
                console.error("❌ Signature mismatch! Check your CF_WEBHOOK_SECRET setting.");
                return res.status(403).send('Forbidden');
            }
            console.log("✅ Webhook Signature Verified Successfully!");
        }

        const payload = JSON.parse(rawBody);
        
        // Use optional chaining (?.) to prevent crashes on Cashfree test pings
        const orderId = payload?.data?.order?.order_id;
        const status = payload?.data?.payment?.payment_status;

        if (orderId && status === 'SUCCESS') {
            console.log(`✅ Payment SUCCESS received for Order: ${orderId}`);
            notifyFrontend(orderId, 'SUCCESS');
        } else {
            console.log("ℹ️ Webhook Event Processed:", payload?.type || "Standard Ping");
        }

        // Always return 200 OK so Cashfree considers the delivery successful
        return res.status(200).send('OK');
    } catch (error) {
        console.error("Webhook processing error:", error.message);
        return res.status(200).send('OK');
    }
});

app.listen(PORT || 3000, () => {
    console.log(`Server running on port ${PORT || 3000}`);
});