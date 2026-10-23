INTENTLOCK V10.8.5 — ASYNC PURCHASE PIPELINE
============================================

THIS IS THE ARCHITECTURAL FIX FOR THE CLOUDFLARE SUBREQUEST ERROR.

ROOT CAUSE
==========

The old WhatsApp webhook tried to do ALL of this inside one HTTP Worker invocation:

WAHA webhook
 -> database dedupe
 -> chat state
 -> create PurchaseSession
 -> many event inserts
 -> Shopify search
 -> candidate policy evaluation
 -> audit mirroring
 -> Shopify quote revalidation
 -> Redis idempotency
 -> Razorpay link creation
 -> database payment writes
 -> WhatsApp response

Cloudflare Workers Free permits only 50 EXTERNAL subrequests per invocation.

Neon's HTTP driver uses an HTTP subrequest for each database query.
Therefore repeatedly shaving one or two DB calls could still leave the
architecture close to the limit.

V10.8.5 stops doing the long transaction in the webhook.


NEW FLOW
========

INVOCATION A — WAHA WEBHOOK
---------------------------

WhatsApp
 -> WAHA
 -> /webhooks/waha
 -> HMAC verification
 -> access gate
 -> dedupe
 -> create PurchaseSession
 -> enqueue RUN_PURCHASE
 -> return HTTP 200 quickly

This invocation is intentionally small.


INVOCATION B — CLOUDFLARE QUEUE CONSUMER
----------------------------------------

RUN_PURCHASE
 -> live Shopify search
 -> deterministic policy
 -> batched Visible Agent Activity
 -> selected candidate
 -> batched tamper-evident audit
 -> live Shopify quote revalidation
 -> Redis idempotency
 -> Razorpay Payment Link
 -> WhatsApp checkout response

A Queue consumer delivery is a new Worker invocation, so it receives a fresh
subrequest budget.

The consumer is configured with:

max_batch_size = 1

This is CRITICAL. One purchase job = one Worker invocation.


STEP-UP FLOW
============

WhatsApp ALLOW ONCE / RAISE LIMIT
 -> resolve authority
 -> enqueue CREATE_PAYMENT
 -> return quickly

Fresh Queue invocation:
 -> consume exact authorization
 -> Razorpay
 -> WhatsApp checkout URL


ADDITIONAL SUBREQUEST REDUCTIONS
================================

V10.8.5 also removes avoidable network amplification:

1. updateSession()
   BEFORE: SELECT + UPDATE = 2 Neon HTTP calls
   NOW:    UPDATE ... RETURNING = 1 Neon HTTP call

2. Candidate activity
   BEFORE:
     PRODUCT_FOUND       x N
     POLICY_DECISION     x N
     MERCHANT_TEXT       x N
     ...
     each as a separate Neon HTTP request

   NOW:
     all candidate events are inserted in ONE ordered SQL statement

3. Audit
   Uses the batched V10.8.2 snapshot design already installed.


CLOUDFLARE QUEUES ON FREE PLAN
==============================

Cloudflare Queues is available on Workers Free.

This design does NOT require upgrading to Workers Paid just to escape the
50-subrequest limit.


INSTALL
=======

1. Extract over:

   D:\IntentLock

2. Apply:

   cd D:\IntentLock
   node .\apply-v10-8-5.mjs

3. Create the Queue ONCE:

   cd D:\IntentLock\apps\worker
   npx wrangler queues create intentlock-purchase-jobs

If it says the queue already exists, that is fine.

4. Patch Wrangler config automatically:

   cd D:\IntentLock
   node .\configure-v10-8-5-queue.mjs

5. Inspect your Wrangler config and confirm it contains:

   PURCHASE_QUEUE
   intentlock-purchase-jobs
   max_batch_size = 1

6. Run tests:

   cd D:\IntentLock
   npm test

ZERO FAILURES REQUIRED.

7. Deploy:

   cd D:\IntentLock\apps\worker
   npx wrangler deploy

The same Worker acts as BOTH:
- Queue producer
- Queue consumer


VERIFY
======

Health:

Invoke-RestMethod "https://intentlock-worker.shdixit10.workers.dev/health" | ConvertTo-Json

Expected:

version = v10.8.5

WhatsApp status:

Invoke-RestMethod "https://intentlock-worker.shdixit10.workers.dev/api/whatsapp/status" | ConvertTo-Json

Expected:

configured                  true
pairingConfigured           true
purchaseQueueConfigured     true


TAIL
====

cd D:\IntentLock\apps\worker
npx wrangler tail intentlock-worker --format pretty

Then from the paired WhatsApp chat:

Find Sony or Bose wireless ANC headphones under 7000 buy automatically if allowed


EXPECTED LOG SHAPE
==================

You should first see the lightweight:

POST /webhooks/waha - Ok

Then the Queue consumer executes separately.

You should NOT see:

Too many subrequests by single Worker invocation


EXPECTED WHATSAPP
=================

Message 1:

IntentLock Agent started
Searching live Shopify...

Then shortly after:

Agent evaluation

Sony ₹5899      ALLOW
Sony ₹6499      STEP_UP
Sony ₹6999      STEP_UP
Bose ₹7499      BLOCK
Boat ₹3999      BLOCK

Selected:
Sony WH-CH720N
₹5899

Razorpay checkout ready
https://rzp.io/...


WHY THIS IS THE FINAL FIX
=========================

This is not another attempt to squeeze the entire flow under 50 calls.

The transaction is now split at the correct architecture boundary:

interactive webhook
        !=
commerce/payment execution

That is also closer to how a production payment system should be designed:
fast ingress, durable job dispatch, idempotent background execution, retries,
and independently observable transaction state.


NO NEON MIGRATION
=================

No new Neon migration is required for V10.8.5.

It reuses all existing V10.1–V10.8.4 tables.


ROLLBACK
========

If needed:

git checkout the previous tag/commit and remove the Queue producer/consumer
entries from Wrangler config.

The Queue itself can remain unused without affecting data.
