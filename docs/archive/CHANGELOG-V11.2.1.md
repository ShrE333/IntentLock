# IntentLock V11.2.1 — Unified Product UI

This is a frontend-only refinement on top of V11.2 TrustOps.

## Why this patch exists
V11.2 introduced Trust Center with a separate dark visual language while the rest of IntentLock remained a warm, minimal light interface. The product looked like two different applications. The V11.2 landing page also changed its copy but retained too much of the previous layout, so the upgrade was not visually obvious.

## What changed
- Rebuilt the shared application shell/sidebar so every route uses the same visual language.
- Added a compact sticky product bar with current route, version and control-plane status.
- Rebuilt the landing page from scratch around the V11.2 story rather than only changing text.
- Added a visual control path showing Agent → PayeeLock → Intent Wallet → Payment → Proof.
- Added a capability strip for payee binding, multi-currency authority, reconciliation and dispute readiness.
- Reframed the real fintech problems as four high-impact product cards.
- Replaced the old architecture grid with a clear five-boundary control timeline.
- Added paired pre-payment / post-payment product storytelling.
- Redesigned Trust Center into the same ivory / forest-green design system.
- Kept a single dark financial-truth visual as an accent rather than making Trust Center an unrelated dark application.
- Retained all V11.2 Trust Center behavior: reconciliation scans, deep PayPal scan, dispute evidence generation/download, PayeeLock status and recent bound payees.

## Backend impact
None.

No database migration, payment logic, PayPal logic, eBay logic, wallet policy, PayeeLock logic, reconciliation behavior, proof logic or dispute evidence logic is changed by this patch.
