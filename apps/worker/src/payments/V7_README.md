# V7 — Razorpay Test Mode

1. Run `db/v7_payment_links.sql` in Neon.
2. Add Test Mode credentials to `.dev.vars`:
   - RAZORPAY_KEY_ID
   - RAZORPAY_KEY_SECRET
   - RAZORPAY_WEBHOOK_SECRET
3. Create payment-specific approval with `ttlSeconds: 1200`.
4. POST exact intent + proposal + approval token to `/api/payments/create-link`.
5. Open returned `short_url` and complete a Razorpay Test Mode payment.
6. Configure `/webhooks/razorpay` and subscribe to `payment_link.paid`.

The webhook signature is verified over the raw request body before JSON parsing.
Duplicate webhook payloads are deduplicated in Neon by SHA-256 payload hash.

Use a proposal quote expiry at least 20 minutes in the future for the payment-link demo.
