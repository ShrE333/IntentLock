# V5 — Neon PostgreSQL + Tamper-Evident Audit Ledger

## Database

Run `db/schema.sql` once in the Neon SQL editor.

Then add the Neon connection string to:

`apps/worker/.dev.vars`

Example:

DATABASE_URL=postgresql://...
APPROVAL_SIGNING_SECRET=...

Restart Wrangler after changing `.dev.vars`.

## Audit model

Each Intent ID is an audit stream.

Every event stores:

- unique event ID
- stream ID
- event type
- structured payload
- canonical payload string
- event timestamp
- previous event hash
- current event hash

Hash formula:

SHA256(
  previous_hash_or_GENESIS
  + "|"
  + event_id
  + "|"
  + stream_id
  + "|"
  + event_type
  + "|"
  + canonical_payload
  + "|"
  + occurred_at
)

The PostgreSQL append function uses `pg_advisory_xact_lock` so concurrent
writers cannot create two events pointing to the same chain head.

## Verification

GET /api/audit/:intentId

returns the complete event stream plus:

{
  "chain": {
    "valid": true,
    "checkedEvents": 7,
    "headHash": "..."
  }
}

If any stored canonical payload or hash is altered, verification fails.
