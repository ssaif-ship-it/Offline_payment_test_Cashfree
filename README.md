# Cashfree Offline Payments - SoftPOS + QR Demo

This repository demonstrates an end-to-end integration pattern for Cashfree Offline Payments (SoftPOS and QR) using Node.js (Express) backend and a minimal Vanilla JS + Tailwind frontend.

Files:
- `server.js` - Express backend exposing endpoints for creating terminals, orders, dynamic QR sessions, SoftPOS push, and webhook handling.
- `public/index.html` and `public/app.js` - Frontend UI to generate dynamic QR, push SoftPOS transactions, and show static QR.
- `.env.example` - environment variables to configure API keys and webhook secret.

Quick start:
1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:

```bash
npm install
```

3. Run the server in dev:

```bash
npm run dev
```

4. Open `http://localhost:3000` to view the frontend.

Notes & Production Guidance:
- Replace in-memory `orders` Map with a persistent DB.
- Ensure `CF_BASE_URL`, `CF_CLIENT_ID`, `CF_CLIENT_SECRET`, and `WEBHOOK_SECRET` are set correctly from Cashfree dashboard.
- In Cashfree dashboard set webhook callback URL to `https://your-server.com/cashfree-webhook` and whitelist server IPs.
- Signature verification assumes HMAC-SHA256 over raw request body with secret `WEBHOOK_SECRET`. Confirm header name in the dashboard and adjust `WEBHOOK_SIGNATURE_HEADER`.
- Use HTTPS in production and secure your `.env` values.
