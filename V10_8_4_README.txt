INTENTLOCK V10.8.4 — AUDIT MIRROR SCHEMA HOTFIX
===============================================

ROOT CAUSE
==========

V10.8.2 changed audit mirroring from:

one PurchaseSession event -> one audit event

to:

many PurchaseSession events -> one tamper-evident snapshot audit event

This was necessary to avoid Cloudflare's per-invocation subrequest ceiling.

However, the original table schema still contained:

  audit_event_id UUID NOT NULL UNIQUE

That uniqueness rule no longer matches the new batched design.

When multiple PurchaseSession events tried to point to the same snapshot audit event,
Neon raised:

  duplicate key value violates unique constraint
  session_audit_mirrors_audit_event_id_key


FIX
===

Drop UNIQUE from audit_event_id.

Keep:

  session_event_id PRIMARY KEY

so each PurchaseSession event can still be mirrored only once.

Add a normal index on audit_event_id so reverse lookup remains efficient.


APPLY
=====

1. Extract over:

   D:\IntentLock

2. Apply code version bump:

   cd D:\IntentLock
   node .\apply-v10-8-4.mjs

3. Run this COMPLETE file in Neon SQL Editor:

   D:\IntentLock\apps\worker\db\v10_8_4_audit_mirror_fix.sql

4. Tests:

   npm test

5. Deploy:

   cd D:\IntentLock\apps\worker
   npx wrangler deploy

6. Verify:

   Invoke-RestMethod "https://intentlock-worker.shdixit10.workers.dev/health" | ConvertTo-Json

Expected:

  version = v10.8.4


NO DATA LOSS
============

This migration does not delete audit events or PurchaseSession events.
It only removes an incorrect uniqueness constraint.
