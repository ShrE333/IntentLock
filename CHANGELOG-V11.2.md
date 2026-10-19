# IntentLock V11.2 — TrustOps

V11.2 turns IntentLock from a pre-payment authorization layer into an end-to-end financial control plane.

## PayeeLock
- Binds a structured payee identity fingerprint into the payment authorization context.
- eBay uses the structured seller username as the payee ID.
- The fingerprint includes provider, payee ID and merchant country.
- Revalidation fails with `PAYEE_IDENTITY_CHANGED_REAUTHORIZE` if the payee changes after authorization.
- Optional `PAYEELOCK_MODE=enforce` requires an explicit trusted-payee registry.
- Legacy V11.0/V11.1 quote hashes remain stable because payee fields are omitted for historical transactions that never contained them.
- Proof Receipt v1.3 includes the payee binding.

## Reconciliation Watchdog
- Scans recent PurchaseSessions and compares session state, payment state, wallet ledger and proof receipt.
- Classifies sessions as HEALTHY, DRIFT, PENDING, STALE_PENDING, CLOSED or NO_PAYMENT.
- Optional deep scan reads the PayPal capture state using a read-only API call.
- Detects provider-completed/internal-pending drift, captured-without-ledger, captured-without-proof and related inconsistencies.
- A protected operations reconciliation action replays only already-persisted, signature-verified PayPal capture evidence.
- The mutation endpoint is disabled unless `TRUSTOPS_ADMIN_TOKEN` is configured; the public Trust Center is read-only.
- Reconciliation never creates a new order, authorization or capture.

## Dispute Defense Engine
- Generates a deterministic evidence packet for an existing PurchaseSession.
- Supports unauthorized-transaction, item-not-received, not-as-described and duplicate-charge evidence profiles.
- Bundles original intent, wallet authority, policy decision, product/merchant facts, PayeeLock binding, provider IDs, capture, wallet ledger, proof receipt and audit-chain verification.
- Produces an evidence completeness report instead of pretending unavailable evidence exists.
- Produces a SHA-256 packet hash and downloadable JSON from the UI.
- PayPal dispute submission itself remains a separate adapter; V11.2 does not fabricate disputes or auto-concede a case.

## Frontend
- Adds a new `/trust-center` product surface with a dark fintech operations design.
- Live reconciliation table with optional PayPal deep scan and safe reconciliation action.
- Dispute evidence generator with coverage visualization and JSON export.
- Recent PayeeLock identity graph.
- Updated navigation and landing page to reflect PayPal, Razorpay, eBay, PayeeLock, reconciliation and dispute evidence.

## Database
- No database migration is required.
- V11.2 reuses the existing PurchaseSession, payment, webhook evidence, wallet ledger, proof and audit tables.
