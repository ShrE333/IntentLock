INTENTLOCK V10.5 — WHATSAPP / WAHA CHANNEL

GOAL
====
WhatsApp is a channel adapter to the SAME PurchaseSession pipeline.

WhatsApp
  -> WAHA
  -> /webhooks/waha
  -> PurchaseSession(channel=WHATSAPP)
  -> Intent Wallet
  -> Commerce Connector
  -> Policy
  -> Step-Up
  -> same sessionId / same event trace

COMMANDS
========
HELP
WALLETS
USE 1
WALLET
STATUS
RESET
ALLOW ONCE
RAISE LIMIT
REJECT

After a wallet is selected, ordinary natural-language messages are purchase goals.

Example:
Find Sony or Bose wireless ANC headphones under ₹7,000. Buy automatically if allowed.

SECURITY
========
- WAHA API protected by X-Api-Key.
- WAHA -> IntentLock webhook authenticated with HMAC-SHA512.
- Raw webhook body is verified before JSON parsing.
- webhook/message IDs are deduplicated in Neon.
- fromMe events are ignored.
- group/channel messages are ignored in this hackathon build.
- merchant text still stays untrusted.
- WhatsApp never receives the raw one-time authorization token.
- WAHA secrets are Worker secrets / EasyPanel environment values only.

INSTALL INTENTLOCK PATCH
========================
1. Extract over D:\IntentLock

2. Apply:
   cd D:\IntentLock
   node .\apply-v10-5.mjs

3. Neon:
   run apps/worker/db/v10_5_whatsapp.sql

4. Tests:
   npm test

Expected roughly:
   15 test files
   45 tests
   zero failures

DO NOT DEPLOY UNTIL YOU HAVE THE PUBLIC WAHA HTTPS URL.

CLOUDFLARE WORKER SECRETS
=========================
From D:\IntentLock\apps\worker:

npx wrangler secret put WAHA_BASE_URL
npx wrangler secret put WAHA_API_KEY
npx wrangler secret put WAHA_WEBHOOK_SECRET

Values:
WAHA_BASE_URL        = your EasyPanel WAHA HTTPS URL
WAHA_API_KEY         = same API key configured in WAHA
WAHA_WEBHOOK_SECRET  = same HMAC key configured as WHATSAPP_HOOK_HMAC_KEY in WAHA

Do NOT paste these values into chat or Git.

Then:
npx wrangler deploy

Verify:
Invoke-RestMethod https://intentlock-worker.shdixit10.workers.dev/health | ConvertTo-Json
Invoke-RestMethod https://intentlock-worker.shdixit10.workers.dev/api/whatsapp/status | ConvertTo-Json

Expected:
health version v10.5
whatsapp configured true

WAHA TEST FLOW
==============
1. Open WAHA dashboard.
2. Connect using WAHA_API_KEY.
3. Create/start session named:
   default
4. Scan QR from WhatsApp Linked Devices.
5. Wait until session is WORKING.
6. Send "HELP" to the connected number from another WhatsApp account.

Demo:
WALLETS
USE 1
Find Sony or Bose wireless ANC headphones under ₹7,000. Buy automatically if allowed.

The WhatsApp-created session should appear in Neon purchase_sessions with:
channel = WHATSAPP

If step-up occurs, reply:
ALLOW ONCE
or
RAISE LIMIT
or
REJECT

NEXT
====
V10.6:
PurchaseSession -> one-time authorization consumption -> Redis -> Razorpay
-> verified webhook -> wallet spend update -> Proof Receipt.
