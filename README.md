# IntentLock

## The Authorization Firewall for Agentic Commerce

**AI can decide what to buy. IntentLock decides what money is actually allowed to do.**

IntentLock sits between probabilistic AI reasoning and deterministic financial execution. A user can express a purchase goal in natural language; the agent can search, compare and propose products; but only IntentLock can grant bounded authority to spend.

> **Reasoning ≠ Authority · Recommendation ≠ Permission · Provider response ≠ trusted financial state**

---

## End-to-end pipeline

```text
Natural-language user goal
        ↓
AI intent understanding / query planning
        ↓
Commerce discovery
Shopify / eBay adapter / demo marketplace
        ↓
Structured product + merchant facts
        ↓
PayeeLock identity binding
        ↓
FX normalization into wallet authority
        ↓
Intent Wallet deterministic policy
        ↓
ALLOW / STEP_UP / BLOCK
        ↓
Payment capability selection
PayPal / Razorpay
        ↓
PayPal AUTHORIZE → revalidate → CAPTURE
        ↓
Verified provider webhook
        ↓
Replay-safe wallet ledger
        ↓
Cryptographic proof receipt
        ↓
Reconciliation Watchdog
        ↓
Post-purchase controls
Refund Firewall + dispute evidence
```

The LLM is intentionally outside the trusted financial computing base. It may interpret and propose. It does not directly authorize money movement.

---

## Natural-language agent input

A user can start with a goal such as:

```text
Find Sony or Bose wireless ANC headphones under $50.
Buy automatically if allowed.
```

IntentLock separates that request into two responsibilities:

1. **Discovery** — derive a clean marketplace query and find relevant products.
2. **Authority** — evaluate the returned structured facts against deterministic wallet policy.

Wallet policy is not injected into marketplace search, so the system cannot silently manufacture an ALLOW result by hiding disallowed candidates.

Natural-language **purchase goals** are implemented. A natural-language **authority compiler** that turns prose such as “give my agent ₹30,000 for one week, ask above ₹5,000” into a reviewable structured Intent Wallet is planned for the next major version.

---

## Intent Wallets

An Intent Wallet is a delegated authority envelope, not a bank account. It defines exactly what an agent may do on a user's behalf.

Current controls include:

- total spending authority
- remaining authority
- autonomous purchase limit
- hard per-transaction ceiling
- allowed categories
- allowed brands
- blocked brands
- required features
- wallet currency and buyer country
- expiry and revocation
- human step-up for exact-quote one-time approval

The same transaction can become `ALLOW`, `STEP_UP`, or `BLOCK` depending on actual wallet data. The decision engine is deterministic and independently regression-tested.

---

## PayeeLock

PayeeLock binds structured merchant/payee identity into the authorization context before payment.

It provides:

- provider + payee identity binding
- merchant-country binding
- SHA-256 payee fingerprint
- execution-time identity revalidation
- payee-substitution blocking
- optional trusted-payee registry
- observation and enforcement modes

For eBay, the current identity is the structured seller username returned by the API. It is a marketplace seller identity, not a bank-verified legal beneficiary identity.

---

## Multi-currency authority

Merchant presentment currency and wallet authority currency may differ.

Example:

```text
Merchant quote:  USD 49.00
Intent Wallet:   INR
Bound FX quote:  83.5 INR/USD
Authority cost:  INR 4,091.50
```

FX facts are bound before policy evaluation and revalidated before sensitive payment transitions. Demo-static FX is explicitly labeled as demo data; the architecture also supports a live quote source.

---

## Payments

### PayPal

The PayPal path uses:

```text
Order with intent=AUTHORIZE
        ↓
Buyer approval
        ↓
Authorization hold
        ↓
Commerce + FX + policy + payee revalidation
        ↓
Capture request
        ↓
Verified PayPal webhook
        ↓
Wallet debit exactly once
        ↓
Proof receipt
```

A browser redirect or successful API call cannot directly mark a transaction `CAPTURED`.

A full sandbox transaction has been exercised end to end during development, including order, authorization, capture, verified webhook, ledger settlement and proof generation.

### Razorpay

Razorpay remains available as an alternate payment rail with verified webhook handling and idempotent execution.

---

## Commerce connectors

Implemented connector architecture includes:

- demo marketplace
- PayPal multi-currency demo marketplace
- Shopify Storefront connector
- external JSON catalog connector
- eBay Browse connector

The eBay adapter implements OAuth, search, item details, seller identity, structured aspects and payment-time revalidation. **Live eBay production use remains dependent on external eBay API approval/credentials.** IntentLock does not claim that a separate PayPal checkout fulfills an eBay listing.

---

## TrustOps

TrustOps keeps the transaction under control after checkout.

### Reconciliation Watchdog

It compares:

```text
PurchaseSession
↕
Provider payment state
↕
Wallet ledger
↕
Proof receipt
```

and classifies transactions as healthy, pending, stale, closed or drifted. A protected recovery action replays only already-persisted verified PayPal capture evidence; it never creates a new payment during reconciliation.

### Dispute Defense

IntentLock can reconstruct a dispute evidence packet from the original transaction:

- user intent
- wallet authority
- policy decision
- exact product/merchant
- PayeeLock binding
- provider IDs
- verified capture evidence
- wallet ledger
- proof receipt
- audit-chain state

PayPal dispute discovery/detail APIs are integrated. IntentLock deliberately does not fabricate shipping or fulfillment evidence.

---

## Refund Firewall

V11.4 extends deterministic controls beyond capture.

Before a refund is allowed, IntentLock checks:

- original session was captured
- provider payment is complete
- currency matches the original capture
- cumulative refunds cannot exceed the original payment
- refund falls inside the configured age window
- unresolved disputes can block automatic refunding
- historical wallet authority restoration is calculated from the original authorization context

Provider POST success does not immediately restore wallet authority. IntentLock verifies refund state from PayPal, then applies a replay-safe wallet credit.

### V11.4.1 reliability hardening

V11.4.1 adds two important safeguards:

1. **Unknown refund outcome remains unknown.** Network failures, timeouts, 5xx responses, rate limits and other ambiguous provider outcomes keep the local refund reservation in `REQUESTED`. Retrying uses the exact same `PayPal-Request-Id` rather than converting an uncertain financial state into a false failure.
2. **Final partial refunds close exactly.** When several cross-currency partial refunds would otherwise leave a one-cent rounding residue, the final refund restores the exact remaining historical wallet debit.

---

## Security invariants

IntentLock is built around these invariants:

- merchant text is untrusted data, never financial authority
- wallet policy may restrict a recommendation but cannot be bypassed by the model
- risk may tighten authority but may never expand it
- payment creation is idempotent
- one-time approvals are exact-quote bound
- payee identity is rebound and revalidated
- capture is webhook-gated
- replayed provider evidence cannot double-debit a wallet
- refund reconciliation cannot double-credit a wallet
- operator money-moving actions require a backend-only `TRUSTOPS_ADMIN_TOKEN`

---

## Main product surfaces

```text
/                 Overview
/new-purchase     Natural-language purchase pipeline
/wallets          Intent Wallets and policy simulator
/commerce         Commerce discovery
/trust-center     Transaction Control / TrustOps
/post-purchase    Refund Firewall and dispute guard
/proof/...        Proof Receipts
/demo             WhatsApp entry channel
/security-lab     Adversarial scenarios
/evals            Evaluation suite
/audit            Audit-chain inspection
/how-it-works     Architecture walkthrough
```

WhatsApp is an input channel into the same PurchaseSession pipeline; it is not a separate payment system.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript |
| Hosting | Vercel |
| Backend | Cloudflare Workers |
| Agent runtime | Durable Objects / Agents |
| AI | Cloudflare Workers AI |
| Async settlement | Cloudflare Queues |
| Database | Neon PostgreSQL |
| Idempotency | Upstash Redis |
| Payments | PayPal + Razorpay |
| Commerce | Shopify + eBay adapter + provider-neutral connectors |
| Messaging | WhatsApp via WAHA |
| Integrity | HMAC-SHA256 + SHA-256 audit/proof chains |
| Testing | Vitest + PGlite |

---

## Local setup

```bash
git clone https://github.com/ShrE333/IntentLock.git
cd IntentLock
npm install
```

Create local backend configuration in:

```text
apps/worker/.dev.vars
```

Never commit that file. The repository contains only `.dev.vars.example` placeholders.

Run the Worker:

```bash
npm run dev:worker
```

Run the web app in another terminal:

```bash
npm run dev:web
```

Run tests:

```bash
npm test
```

Production-build the frontend:

```bash
npm --workspace apps/web run build
```

Dry-run the Worker bundle:

```bash
cd apps/worker
npx wrangler deploy --dry-run --outdir .wrangler/ci-dry-run
```

---

## Verification status

The V11.4 checkpoint was manually validated with:

```text
40 test files passed
208 / 208 tests passed
Cloudflare Worker dry-run passed
Vercel frontend check passed
```

V11.4.1 adds targeted refund-reliability and TrustOps-CORS regression tests plus GitHub Actions CI. Run the suite after applying the patch; the CI workflow then repeats worker tests, the Next.js production build and Wrangler dry-run on every push/PR.

Test success demonstrates the covered normal/adversarial/failure paths; it is not a guarantee against every possible financial or security failure.

---

## Version roadmap

| Version | Main milestone |
|---|---|
| V11.0 | PayPal provider-neutral AUTHORIZE → CAPTURE path |
| V11.0.1 | Multi-currency authority |
| V11.0.2 | Resumable capture settlement |
| V11.0.3 | Late verified capture reconciliation |
| V11.1 | eBay Browse commerce adapter |
| V11.2 | PayeeLock + Reconciliation Watchdog + Dispute Defense |
| V11.3 | Transaction reliability and decision transparency |
| V11.4 | Refund Firewall + PayPal dispute integration |
| **V11.4.1** | **Refund ambiguity recovery + rounding closure + CORS + CI/repo integrity** |
| Next | Natural-language authority compiler |

---

## Product thesis

```text
PROBABILISTIC WORLD
AI agent / merchant data
        ↓
INTENTLOCK
Deterministic trust boundary
        ↓
Cryptographic + policy authority
        ↓
Payment provider
        ↓
MONEY
```

**Do not give an AI unrestricted payment authority. Give it bounded, reviewable and provable authority.**
