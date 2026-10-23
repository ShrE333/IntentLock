# IntentLock V11.4.1 — Reliability & Repo Integrity

This stabilization release fixes issues discovered during a read-only audit of the pushed V11.4 repository before starting V11.5.

## Financial reliability

- Refund mutations no longer convert an uncertain provider outcome into `FAILED`.
- Network errors, OAuth uncertainty, 5xx responses, rate limits, timeouts/conflicts remain `REQUESTED`.
- Retrying a `REQUESTED` refund uses the exact same deterministic `PayPal-Request-Id`.
- Stable client-side PayPal 4xx responses remain definitive failures.
- Adds explicit `REFUND_PROVIDER_STATE_UNCERTAIN` session/audit evidence.
- Final partial refunds close against the exact remaining historical wallet debit, preventing cross-currency cent residue.

## TrustOps browser reliability

- Global Worker CORS now allows `x-intentlock-ops-token`.
- This fixes browser preflight for protected refund/reconciliation actions from the Vercel frontend to the Cloudflare Worker.

## Repository integrity

- Replaces the stale V10-era README with the current V11.4.1 architecture and scope.
- Adds GitHub Actions CI for worker tests, Next.js production build and Wrangler dry-run.
- Removes the accidental root `lkdvm` file.
- Adds targeted regression tests for refund ambiguity, final partial-refund rounding and TrustOps CORS.

## Database

No new database migration is required. V11.4.1 uses the existing V11.4 `session_refunds` and `wallet_refund_ledger` schema.
