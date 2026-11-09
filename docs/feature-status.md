# Feature inventory — 2026-11-05 (PayPal row updated 2026-11-09)

> **Update 2026-11-09.** The owner observed one real end-to-end PayPal Sandbox
> settlement against the demo Worker at commit `58a7cfc` (see the PayPal sandbox
> row). Only that flow was newly observed. Every other row below is unchanged and
> was not re-verified. This is sandbox evidence, not production readiness.


Scope: inspected local source at `2c298c67f243663f91bc8bb345878ccf460ccad4`
plus this working change. `git ls-remote origin refs/heads/main` returned that
same SHA. No production service, credential validity or deployed data was tested.
IMPLEMENTED describes code; VERIFIED requires a recorded test. PARTIAL and
EXTERNAL BLOCKER can apply together. See testing and release-readiness for results.

| Feature | Status | Evidence / acceptance gap |
|---|---|---|
| Main Next.js routes and navigation | IMPLEMENTED | `apps/web/e2e/sandbox.spec.ts` enumerates all requested routes, runtime errors and overflow on desktop/mobile; production build includes them |
| Browser auth and wallet isolation | IMPLEMENTED | `access/gate.ts`, `financial-access*.test.ts`, browser separate-visitor test |
| Wallet creation/view, limits, categories/brands/features, currency, expiry | IMPLEMENTED | `wallets/validation.ts`, `wallets/policy.ts`, wallet policy and SQL suites |
| Revocation (agent kill switch) UI/API | IMPLEMENTED | `POST /api/wallets/:id/revoke` (owner/`approve`, idempotent) plus a wallets-page control; `wallet-revoke.test.ts` proves new reservations and provider steps are refused while already-requested verified captures still settle; not yet exercised on the deployed Worker |
| Policy editing UI/API | PARTIAL | SQL policy history exists; no general wallet update route; do not edit DB as a UI workaround |
| Reservations, concurrency, remaining authority | IMPLEMENTED | `wallet-reservations-sql.test.ts`, execution tests; available authority subtracts active holds |
| One-time exact-quote step-up | IMPLEMENTED | `wallets/atomic-stepup.ts`, crypto/session/access and SQL tests |
| Natural-language authority | PARTIAL | Closed grammar, draft/review/confirm, history and simulation exist; INR/week form now parses, missing hard ceiling and restrictions still require clarification; not unrestricted language understanding |
| Commerce orchestration, comparison and selection | IMPLEMENTED | `sessions/orchestrator.ts`, selection/query-planner/risk tests; live provider behavior externally unverified |
| Demo / PayPal sandbox catalogs | IMPLEMENTED, MOCK DATA | Catalog prices, stock and merchant labels are synthetic; no real order fulfillment |
| Shopify Storefront | IMPLEMENTED, EXTERNAL BLOCKER | Search/variant refresh/structured normalization; configured store domain/token required; discovery only |
| Shopify Global Catalog MCP | IMPLEMENTED, EXTERNAL BLOCKER | Flagged read-only UCP discovery, adversarial tests, browser fixtures; no merchant checkout |
| eBay Browse | IMPLEMENTED, EXTERNAL BLOCKER | OAuth/search/details/seller identity tests; approved credentials needed; discovery only |
| External JSON catalogs | IMPLEMENTED, EXTERNAL BLOCKER | `http-json-connector.ts`; authorized catalog URL required; no merchant checkout |
| Amazon / IndiaMART | MISSING | Disabled registry slots are not adapters; authorized API contracts/access required |
| PayPal sandbox flow | VERIFIED (sandbox, owner-observed 2026-11-09, commit `58a7cfc`) | Against the demo Worker with PayPal Sandbox: order created, buyer approved with a Sandbox Personal account, authorization, capture of USD 49.00, `PAYMENT.CAPTURE.COMPLETED` webhook verified through PayPal's signature API, queued, settled with exactly one wallet ledger debit, signed proof receipt created, session CAPTURED. A second delivery of the same event was idempotent (no second debit). Manual observation, not an automated CI test; sandbox only. Replay/SQL tests cover the modules. Not verified: live PayPal, refunds/disputes against real PayPal, real merchant onboarding |
| PayPal setup diagnostics | IMPLEMENTED | `/api/payments/provider` reports missing names and validation issues; no provider/DB connectivity assertion |
| Razorpay | PARTIAL, EXTERNAL BLOCKER | Primitive/webhook/capability tests exist; current executable commerce restriction is sandbox PayPal oriented; a second complete merchant checkout vertical slice is not proven |
| FX and historical refunds | IMPLEMENTED | `payments/fx.ts`, multi-currency and refund-ledger/reliability suites; static rates explicitly demo, external rate source unverified |
| PayeeLock / recipient binding | IMPLEMENTED | Registry + fingerprint + expiry/account binding + execution revalidation; recipient regression suites |
| TrustOps reconciliation / recovery | IMPLEMENTED | Protected routes, verified-evidence replay, late-capture tests; deployed watchdog operations unverified |
| Refunds / partial refunds / ambiguity | IMPLEMENTED | Firewall/reliability/ledger and PayPal post-purchase tests; actual provider refund not exercised |
| Disputes | PARTIAL, EXTERNAL BLOCKER | Provider read APIs and evidence packet exist; shipping/fulfillment evidence deliberately absent |
| WAHA / WhatsApp | IMPLEMENTED, EXTERNAL BLOCKER | Pairing/HMAC/replay/access/commands tests; WAHA service, session, webhook secrets and wallet grants required; end-to-end delivery unverified |
| Risk anomaly controls | PARTIAL | Deterministic injection/risk signals tighten authority; no trained anomaly model or validated statistical detection |
| Per-agent delegation / SDK | PARTIAL | Wallet grants, scoped API clients, `packages/sdk/src/index.ts`; SDK is private TypeScript source outside npm workspaces; no published SDK gate |
| Subscription/recurring mandates, org budgets, enterprise hierarchy | MISSING | Existing grants are foundations, not these product features |
| Passkey step-up / voice / agent-to-agent protocol | MISSING | No production implementation verified |
| Notifications / order tracking / reports | PARTIAL | WAHA transaction notifications and TrustOps history exist; no generalized notification bus, fulfillment ingestion or accounting reporting product |
| Fresh schema | IMPLEMENTED | Ordered 19-migration manifest; disposable schema test added; separate-connection PostgreSQL release script requires local disposable server |
| CI | IMPLEMENTED | Worker/SQL/browser/build/typecheck/dry-run workflow; no automatic production deployment; dependency audit gate added in this change |
| Release identity | PARTIAL | Vercel build-info route; Worker health now supports explicit tested SHA; deployed correlation requires operator configuration |
| Obsolete artifacts | PARTIALLY CLEANED | Root patch-installer files and `*-snippet.txt` were removed and root prose docs moved to `docs/archive/root-legacy/` (2026-11-09); versioned docs under `docs/archive/` and `tools/release-v1151/` (referenced by `docs/V11.5.1-release-verification.md`) remain |

No feature is represented as externally VERIFIED from historical README results.
The complete production acceptance criteria across all requested phases remain open.
