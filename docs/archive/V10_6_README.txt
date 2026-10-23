INTENTLOCK V10.6 — RAZORPAY EXECUTION + WALLET SPEND + PROOF RECEIPT
=====================================================================

THIS MILESTONE CLOSES THE PAYMENT PIPELINE.

PurchaseSession
  -> authority re-check
  -> exact quote SHA-256
  -> one-time auth consumption when required
  -> Redis idempotency
  -> Razorpay Payment Link
  -> existing /webhooks/razorpay endpoint
  -> raw-body HMAC verification
  -> webhook dedupe
  -> atomic wallet spend
  -> PurchaseSession CAPTURED
  -> tamper-evident audit
  -> HMAC-signed Proof Receipt
  -> WhatsApp payment confirmation

NO SECOND RAZORPAY WEBHOOK IS REQUIRED.
V10.6 intercepts PurchaseSession payments at the EXISTING:

  /webhooks/razorpay

and returns null for old V7/legacy payments so the previous handler still works.


INSTALL
=======

1. Extract over:

   D:\IntentLock

2. Apply:

   cd D:\IntentLock
   node .\apply-v10-6.mjs

3. Neon SQL Editor:

   Run the COMPLETE file:

   D:\IntentLock\apps\worker\db\v10_6_payment_proof.sql

4. Tests:

   cd D:\IntentLock
   npm test

Expected if previous suite is unchanged:

   about 50 tests
   zero failures


SECRETS
=======

No new secret is required.

V10.6 reuses:

- DATABASE_URL
- APPROVAL_SIGNING_SECRET
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN
- RAZORPAY_KEY_ID
- RAZORPAY_KEY_SECRET
- RAZORPAY_WEBHOOK_SECRET
- WAHA_BASE_URL
- WAHA_API_KEY

Do not paste any secret into chat or Git.


DEPLOY WORKER
=============

cd D:\IntentLock\apps\worker
npx wrangler deploy

Verify:

Invoke-RestMethod "https://intentlock-worker.shdixit10.workers.dev/health" | ConvertTo-Json

Expected:

version = v10.6


IMPORTANT WALLET CHECK
======================

Use a NEW ACTIVE Intent Wallet if your old Personal Electronics wallet has expired.

Recommended test wallet:

Name:
Personal Electronics V10.6

Total authority:
10000

Auto-buy:
6000

Hard ceiling:
7000

Allowed categories:
electronics

Allowed brands:
Sony, Bose

Blocked:
Boat

Required:
wireless, ANC

Validity:
24 hours


WHATSAPP END-TO-END TEST
========================

Your friend sends:

WALLETS

Then:

USE 1

Then:

Find Sony or Bose wireless ANC headphones under ₹7,000. Buy automatically if allowed.

Expected:

- PurchaseSession created
- marketplace evaluated
- Sony ₹5,899 selected
- authority rechecked
- Razorpay payment link created
- WhatsApp receives the payment URL

IMPORTANT:
IntentLock remains PAYMENT_PENDING at this point.
It does NOT claim CAPTURED merely because a link exists.

Complete the Razorpay TEST payment.

Expected after Razorpay webhook:

- webhook signature verified
- wallet spend applied once
- session -> CAPTURED
- proof receipt generated
- WhatsApp receives:

  Payment captured
  remaining wallet authority
  receipt ID
  proof hash prefix


WEB DEMO
========

After Worker deployment, for local frontend end-to-end testing set:

D:\IntentLock\apps\web\.env.local

NEXT_PUBLIC_INTENTLOCK_API_URL=https://intentlock-worker.shdixit10.workers.dev

Restart:

cd D:\IntentLock
npm run dev:web

Open:

http://localhost:3000/new-purchase

Start a purchase.

When READY_TO_PAY:
click "Create Razorpay Checkout"

After paying:
the page polls the session every 3 seconds.

Expected:

PAYMENT_PENDING
  -> CAPTURED

Then click:

View Proof Receipt

Route:

/proof/<sessionId>


PROOF RECEIPT EVIDENCE
======================

Receipt derives from actual persisted records:

- PurchaseSession
- Intent Wallet
- selected product
- policy decision
- exact quote SHA-256
- step-up / authorization ID when applicable
- one-time authorization token HASH (never raw token)
- Razorpay link ID
- Razorpay payment ID
- verified webhook state
- wallet spend ledger
- remaining authority
- audit chain head
- proof hash
- HMAC proof signature

The Proof Receipt is NOT generated before payment capture.


REPLAY / DUPLICATE DEFENSE
==========================

1. Redis:
   deterministic PurchaseSession payment key with SET NX.

2. Neon:
   one session_payment_links row per session.

3. Razorpay:
   deterministic reference ID.

4. Webhook:
   payload SHA-256 unique in session_payment_webhook_events.

5. Wallet debit:
   wallet_spend_ledger.session_id UNIQUE.

6. Database function:
   apply_intent_wallet_spend_once locks the wallet row and refuses total-authority overflow.

7. Step-Up:
   one-time authorization gets consumed_by_session_id + consumed_at.


STEP-UP END-TO-END TEST
=======================

Create a wallet with:

Auto-buy:
5500

Hard ceiling:
7000

Search the same headphones.

Sony ₹5,899 should require STEP_UP.

From WhatsApp:

ALLOW ONCE

Expected:

- signed exact-quote authorization attached
- V10.6 consumes it for this PurchaseSession
- Razorpay link returned
- second use is rejected
- payment webhook captures
- wallet debited once
- Proof Receipt shows SIGNED_ONE_TIME_AUTHORIZATION


ROADMAP
=======

DONE #1 Intent Wallet
DONE #2 Step-Up
DONE #3 Commerce Connector
DONE #4 PurchaseSession + Visible Agent Activity
DONE #5 WhatsApp / WAHA
THIS #6 Razorpay + Wallet Spend + Proof Receipt

NEXT #7 /v1/authorize API/SDK
NEXT #8 Adaptive Agent Trust Score
