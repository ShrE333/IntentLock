# Architecture

IntentLock separates proposals from financial authority. Next.js calls the Worker
using the configured API origin. `access/gate.ts` authenticates capabilities, API
keys and operators, checks scopes and wallet grants, and denies unlisted routes.
WhatsApp uses authenticated WAHA ingress and the same wallet/session services.

The purchase pipeline is discovery -> normalized product facts -> recipient/FX
binding -> deterministic wallet policy -> risk tightening -> exact-quote step-up
when necessary -> authority reservation -> provider authorization/capture ->
verified evidence -> ledger -> signed proof. Model output is proposal data.

Neon PostgreSQL stores sessions, wallet authority, reservations, ledger entries,
access grants, policy drafts/history, audit chains and provider evidence. Atomic
SQL functions and uniqueness constraints protect concurrent spending and replay.
Cloudflare Queues deliver settlement jobs; retries must retain verified access
context. The Durable Object agent provides stateful reasoning, not independent
permission to pay. Redis supports legacy idempotency paths.

PayPal checkout is AUTHORIZE then CAPTURE. An uncertain capture stays pending;
browser redirects and provider POST responses do not finalize the wallet debit.
Recovery consumes persisted verified evidence and does not create another payment.
Refunds reserve amounts before provider calls and restore historical authority
only after verification. Partial refund rounding closes at the original debit.

Only the demo connectors are executable, only in sandbox, with explicit
server-controlled recipient mappings. Shopify, eBay and JSON catalogs support
discovery/revalidation; discovery is not merchant checkout or fulfillment.

The authority compiler uses a closed grammar, not an LLM grant. Unrecognized
clauses, conflicts and omitted critical controls require review. Draft digests,
expiry, ownership and explicit human confirmation bind activation. It is gated by
`NATURAL_LANGUAGE_WALLETS_ENABLED`.

Future channels should submit authenticated purchase proposals to these services.
They must not implement their own debit, approval or capture paths. Organization
budgets, recurring mandates, passkeys and enterprise approval hierarchies need
separate threat models and complete vertical implementations before exposure.
