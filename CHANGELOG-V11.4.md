# IntentLock V11.4 — Post-Purchase Guard

V11.4 extends the same deterministic financial boundary beyond capture. The main addition is a Refund Firewall plus a real PayPal disputes adapter.

## Refund Firewall
- Evaluates a refund before any provider call.
- Requires the original PurchaseSession and provider payment to be captured/completed.
- Prevents currency substitution and over-refunds.
- Tracks previously requested/pending/completed refunds when calculating the remaining refundable amount.
- Enforces a configurable refund-age policy (`REFUND_MAX_AGE_DAYS`, default 30).
- Optionally blocks automatic refunds while an unresolved PayPal dispute exists (`REFUND_BLOCK_ON_OPEN_DISPUTE`, default true).
- Executes only through the captured PayPal payment identity.
- Uses a deterministic SHA-256 idempotency key and PayPal-Request-Id.
- Adds an atomic database reservation function so concurrent partial refunds cannot exceed the original capture.

## Provider-truth reconciliation
- A successful refund POST does **not** immediately restore Intent Wallet authority.
- IntentLock reads the PayPal refund back through the authenticated Payments v2 API.
- Wallet authority is restored only when PayPal reports the refund as `COMPLETED`.
- Wallet restoration uses the original authorization/FX ratio rather than a new exchange rate.
- Refund reconciliation is replay-safe through `wallet_refund_ledger`.
- Refund reconciliation remains valid even if the original Intent Wallet has since expired or been revoked; the wallet status itself is never reactivated.

## PayPal Disputes adapter
- Lists disputes associated with the captured transaction.
- Reads the full PayPal dispute object, including lifecycle/status/evidence requirements exposed by PayPal.
- The existing IntentLock dispute evidence packet remains the source of internal proof.
- A protected action can send an IntentLock evidence summary only when PayPal exposes a send-message action for the current dispute state.
- V11.4 deliberately does not auto-accept claims, auto-make offers, fabricate fulfillment evidence, or pretend a missing document exists.

## Database
Adds:
- `session_refunds`
- `wallet_refund_ledger`
- `reserve_session_refund_v11_4(...)`
- `apply_intent_wallet_refund_once_v11_4(...)`

Migration: `apps/worker/db/v11_4_post_purchase_guard.sql`

## Tests
Adds policy, PayPal adapter, and isolated PostgreSQL tests for:
- valid partial refunds
- over-refund blocking
- currency substitution blocking
- non-captured transaction blocking
- dispute collision blocking
- refund-age policy
- historical FX-ratio wallet credits
- PayPal refund POST/read APIs
- PayPal dispute list/read/message APIs
- exactly-once wallet credit
- refund reconciliation after wallet expiry/revocation
- atomic concurrent refund reservation ceiling
