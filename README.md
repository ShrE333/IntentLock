# IntentLock

**AI can decide what to buy. IntentLock decides what money is allowed to do.**

IntentLock is an authorization firewall for agentic commerce. An AI agent may search, compare and propose a purchase, but its output is treated as untrusted advice. A deterministic layer (recipient binding, FX, wallet policy, risk signals) decides ALLOW, STEP_UP or BLOCK, reserves bounded authority, and only then lets a payment provider move money. Provider responses and browser redirects are never trusted as financial state; only verified, signed provider evidence settles the ledger.

> Reasoning is not authority. Recommendation is not permission. A provider response is not trusted financial state.

This is a hackathon entry running on **PayPal Sandbox**. It is not a production payment system (see [Verified status](#verified-status)).

## How it works

```text
goal -> discovery -> AI agent proposal (untrusted)
     -> PayeeLock + FX + wallet policy + risk  => ALLOW | STEP_UP | BLOCK
     -> authority reservation
     -> PayPal AUTHORIZE -> buyer approval -> CAPTURE
     -> signed PayPal webhook -> queue
     -> exactly-once wallet ledger debit
     -> HMAC-signed proof receipt
```

1. **Goal and discovery.** The buyer states a goal; connectors return normalized product facts (demo catalog, PayPal sandbox demo sellers; Shopify/eBay/JSON catalogs are discovery only).
2. **AI agent proposal.** An AI shopping-agent step (new in this release, `apps/worker/src/agent/shopping-agent.ts`) ranks candidates and may propose a product and quantity. Its output is validated and filtered, and every candidate still goes through the deterministic policy. The agent can be wrong or manipulated; it cannot grant itself authority.
3. **Decision.** PayeeLock binds the recipient, FX normalizes currency (static demo rates), and the wallet policy plus risk signals return ALLOW, STEP_UP (one-time, exact-quote human approval) or BLOCK.
4. **Reservation.** Authority is reserved atomically in PostgreSQL before any provider call, so concurrent sessions cannot overspend.
5. **PayPal.** AUTHORIZE, buyer approval, CAPTURE. An uncertain capture stays pending.
6. **Settlement.** A PayPal webhook is verified through PayPal's signature API, queued, and settled with one ledger debit (idempotent on the event). A signed proof receipt is produced.

Details: [docs/architecture.md](docs/architecture.md).

## Verified status

Observed manually by the owner on 2026-11-09 against the demo Worker at commit `58a7cfc`, using PayPal Sandbox:

- Real sandbox order created; buyer approved it with a Sandbox Personal account.
- Authorization, then capture of USD 49.00.
- PayPal webhook `PAYMENT.CAPTURE.COMPLETED` verified by PayPal's signature API, queued, and settled with exactly one wallet ledger debit.
- Signed proof receipt created; session reached CAPTURED.
- A second delivery of the same event was idempotent (no second debit).
- Refund firewall (same day, commit `eb08b63` plus refund fix): an over-refund of USD 100 against the USD 49 capture was returned as BLOCK (`REFUND_EXCEEDS_REMAINING_CAPTURE`) with no provider call; a USD 10 partial refund was executed through PayPal, and wallet authority was restored only after an authenticated PayPal refund read confirmed COMPLETED (one refund-ledger entry, enforced unique per refund).
- Worker test suite: 746 tests passing locally at that point.

**Not done / not verified:**

- Production readiness. This is sandbox only.
- Real merchant onboarding; recipients are server-mapped sandbox demo sellers.
- Live FX; rates are static demo values.
- Disputes have not been exercised against real PayPal (only tests). A real sandbox refund has been (see Verified status).
- WhatsApp (WAHA), eBay, Shopify and Razorpay have not been verified end to end.
- The AI shopping-agent step is new and its behavior depends on the configured model; it is advisory only.

Per-feature status and evidence gaps: [docs/feature-status.md](docs/feature-status.md).

## Architecture and stack

| Layer | Technology |
|---|---|
| Web app | Next.js 15 / React 19 (`apps/web`) |
| API and policy engine | Cloudflare Worker, TypeScript (`apps/worker`) |
| Async settlement | Cloudflare Queues; Durable Object for agent state |
| Database | Neon PostgreSQL (atomic reservation, ledger and uniqueness constraints) |
| Payments | PayPal Sandbox (AUTHORIZE then CAPTURE, signed webhooks) |
| AI | Workers AI model for the shopping-agent step (untrusted proposals) |
| Tests | Vitest (worker, PGlite SQL suites), Playwright (web) |

## Repository map

| Path | Contents |
|---|---|
| `apps/web` | Next.js UI: purchase flow, wallets, trust center, proof, security lab |
| `apps/worker/src/access` | Auth gate: demo capabilities, API keys, scopes, wallet grants, rate limits |
| `apps/worker/src/sessions`, `agent` | Purchase orchestration and the AI shopping agent |
| `apps/worker/src/wallets`, `policy`, `risk` | Wallet authority, reservations, policy and risk signals |
| `apps/worker/src/payments`, `session-payments` | PayPal, PayeeLock, FX, settlement |
| `apps/worker/src/commerce`, `catalog` | Connectors and catalogs |
| `apps/worker/src/queue`, `trust-center`, `post-purchase` | Settlement queue, reconciliation, refunds and disputes |
| `apps/worker/src/tests` | Worker test suites |
| `packages/sdk` | Private TypeScript SDK source |
| `tools/release-v1151` | Release verification tooling |
| `docs/` | Documentation; `docs/archive/` holds historical release notes |

## Local development

Requires Node 22. On Windows use `npm.cmd` if PowerShell blocks `npm.ps1`.

```powershell
npm.cmd ci
copy apps\worker\.dev.vars.example apps\worker\.dev.vars   # then fill in sandbox values; never commit it
npm.cmd run dev:worker
npm.cmd run dev:web
```

Tests and checks:

```powershell
npm.cmd test                                              # worker tests (vitest)
npm.cmd --workspace apps/worker run typecheck             # tsc --noEmit --strict
npm.cmd --workspace apps/web run build
npm.cmd --workspace apps/web run test:browser             # Playwright
npm.cmd --workspace apps/worker run check:paypal          # sandbox readiness diagnostics
```

Demo rate limits (capability issuance, demo wallets per hour) are configurable for shared-IP venues through `DEMO_ISSUE_PER_IP_PER_HOUR`, `DEMO_ISSUE_GLOBAL_PER_HOUR`, `DEMO_WALLETS_PER_PRINCIPAL_PER_HOUR` and `DEMO_WALLETS_PER_IP_PER_HOUR`; invalid values fall back to the defaults. See `apps/worker/.dev.vars.example`.

## Documentation

- [Hackathon submission](docs/hackathon/SUBMISSION.md) and [demo script](docs/hackathon/DEMO_SCRIPT.md)
- [MCP server for external agents](docs/mcp/README.md) (read and evaluate only)
- [API reference: OpenAPI 3.1 and Postman](docs/api/README.md)
- [Architecture](docs/architecture.md)
- [Feature status and evidence](docs/feature-status.md)
- [PayPal sandbox runbook](docs/paypal-sandbox-runbook.md)
- [Security and remaining advisories](docs/security.md)
- [Testing](docs/testing.md)
- [Deployment and rollback](docs/deployment.md)
- [Release readiness and blockers](docs/release-readiness.md)
