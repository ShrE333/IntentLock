# IntentLock V11.2.2 — End-to-End Product Story

This patch fixes the main product/UX problem in V11.2.1: features were visually polished but still presented as separate concepts rather than one financial transaction lifecycle.

## What changed

- Rebuilt the landing-page story around one transaction from user intent to proof.
- Rebuilt Trust Center as a transaction-first inspector rather than three disconnected feature demos.
- Trust Center automatically selects a `sessionId` from the URL, the latest captured transaction, or a recent session.
- The same selected PurchaseSession now drives:
  - original user intent
  - selected product / merchant
  - PayeeLock identity
  - deterministic policy
  - provider order / authorization / capture
  - verified webhook state
  - wallet ledger state
  - proof state
  - reconciliation status
  - dispute evidence generation
- Added a nine-checkpoint lifecycle view: Intent → Commerce → PayeeLock → Authority → Provider Order → Authorize/Capture → Ledger → Proof → TrustOps.
- Watchdog rows can now be inspected as the selected end-to-end transaction.
- Dispute Defense no longer asks for a disconnected manual session ID; it uses the selected transaction.
- Legacy sessions created before PayeeLock are explicitly labeled as legacy instead of implying seller evidence exists.
- Moved WhatsApp later in the landing story and explains it as an input channel into the same pipeline.
- Removed stale default WhatsApp availability date claims. A date is shown only when a future `NEXT_PUBLIC_INTENTLOCK_DEMO_END_DATE` is configured.
- Clarified navigation labels: Run Purchase, Commerce Search, Transaction Control.
- Corrected the implementation-status wording for eBay: adapter-ready, API access pending.

## No backend or database changes

V11.2.2 is frontend-only. It reuses existing PurchaseSession, payment, proof and TrustOps APIs.
