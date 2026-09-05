INTENTLOCK V10.8.2 — CLOUDFLARE SUBREQUEST HOTFIX
=================================================

ROOT CAUSE
==========

The WhatsApp -> Shopify -> Policy path was working.

The PurchaseSession reached READY_TO_PAY and selected the Sony ₹5,899
candidate.

The failure occurred when payment execution began.

Old mirrorSessionTraceToAudit() did:

FOR EACH PurchaseSession event:
  1. SELECT whether audit row exists
  2. append_audit_event(...)
  3. INSERT session_audit_mirrors

A realistic purchase already has ~18 PurchaseSession events before payment.

That can create ~54 Neon HTTP subrequests just for audit mirroring,
before counting:

- WhatsApp sendText
- session repository calls
- Shopify Storefront API
- Redis
- Razorpay
- wallet calls
- payment repository calls

Cloudflare therefore terminated the invocation with:

  Too many subrequests by single Worker invocation


FIX
===

V10.8.2 changes the audit design to:

1 DB request:
  fetch all currently-unmirrored PurchaseSession events

1 DB request:
  append ONE tamper-evident PURCHASE_SESSION_TRACE_SNAPSHOT audit event
  containing the complete ordered trace

1 DB request:
  bulk-mark exactly those session event IDs as mirrored

So the audit step drops from O(N) network requests to O(1).

The complete evidence is still preserved inside the hash-chained audit event.


NO DATABASE MIGRATION
=====================

No Neon SQL migration is required.

The existing:
  audit_events
  session_audit_mirrors
  purchase_session_events

tables are reused.


APPLY
=====

Extract over:

  D:\IntentLock

Then:

  cd D:\IntentLock
  node .\apply-v10-8-2.mjs
  npm test

Zero failures required.

Deploy:

  cd D:\IntentLock\apps\worker
  npx wrangler deploy

Verify:

  Invoke-RestMethod "https://intentlock-worker.shdixit10.workers.dev/health" | ConvertTo-Json

Expected:

  version = v10.8.2


TEST
====

Keep GOWS / WAHA WORKING.

Start:

  cd D:\IntentLock\apps\worker
  npx wrangler tail intentlock-worker --format pretty

From the already paired WhatsApp tester:

  Find Sony or Bose wireless ANC headphones under 7000 buy automatically if allowed

Expected:

  Shopify live search
       ->
  Sony ₹5899 ALLOW
       ->
  live Shopify quote revalidation
       ->
  payment authority recheck
       ->
  Razorpay Payment Link
       ->
  WhatsApp receives checkout URL


IMPORTANT
=========

Do NOT increase the Cloudflare subrequest limit as the primary fix.

On Workers Free the external subrequest ceiling is 50/request.
Even on a paid plan, leaving an N+1 database design here would be poor
production architecture.

This hotfix removes the network-amplification problem instead.
