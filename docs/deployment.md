# Deployment and sandbox configuration

No production deploy, database migration or live-money request is authorized by
this release work. Use separate preview Worker, queue, Durable Object namespace,
Neon branch/database, Redis and provider sandbox accounts. The tracked Wrangler
config has default resource names: a dry-run does not establish environment
isolation. Do not run its deploy command against production during validation.

## Operator setup

1. Create a disposable Neon branch/database. Apply `apps/worker/db/release-order.json`
   in order through a reviewed migration journal with checksums. Existing databases
   need their prior migration history established first. Do not rerun raw ALTER
   migrations blindly; never use reset/truncate against production.
2. Copy `.dev.vars.example` to ignored `apps/worker/.dev.vars` for local work.
   Store hosted secrets using the provider secret manager. Never put secrets into
   `NEXT_PUBLIC_*`, source, screenshots, terminal output or a commit.
3. Obtain a PayPal developer **sandbox business** application and a separate buyer
   sandbox account. Set `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`,
   `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ACCOUNT_MERCHANT_ID`.
   The merchant ID must be the connected business seller for those OAuth keys.
   Register the sandbox Worker's `/webhooks/paypal` callback and subscribe to the
   authorization/capture/refund events the service handles. Verify real delivery
   and signature validation before claiming settlement works in that deployment.
4. Set `PAYPAL_RETURN_BASE_URL` to the preview frontend's HTTPS origin (no path,
   query, fragment or credentials). Local sandbox permits `http://localhost:3000`.
   Set `APPROVAL_SIGNING_SECRET` to at least 24 cryptographically random characters,
   and `DATABASE_URL` to the isolated database connection string.
5. Set `PAYPAL_MERCHANT_BINDINGS_JSON` to an array of explicitly authorized mappings.
   Each entry needs `mappingId`, positive `mappingVersion`, `environment: sandbox`,
   `connectorId: paypal-demo-marketplace`, `catalogProvider: paypal-demo`,
   `catalogSellerId` (for example the catalog key `audiohub-sandbox`),
   `merchantOfRecordId`, `checkoutMerchantId`, the actual `paypalMerchantId`,
   `integration: DIRECT_MERCHANT`, documented `approvalReference`, and a future ISO
   `validUntil`. The PayPal merchant ID must match `PAYPAL_ACCOUNT_MERCHANT_ID`.
   Map only sellers this business is authorized to represent in the synthetic
   sandbox catalog. Partner onboarding is not implemented. Do not copy test IDs.
6. Configure `INTENTLOCK_ADMIN_KEY` for API client administration and a separate
   `TRUSTOPS_ADMIN_TOKEN` for protected operations. Create scoped API clients and
   explicit wallet grants. Configure `CORS_ALLOWED_ORIGINS` with exact preview
   origins. Public sandbox issuance requires `DEMO_ACCESS_ENABLED=true`; keep it
   disabled for a non-demo deployment. Compiler UI requires
   `NATURAL_LANGUAGE_WALLETS_ENABLED=true`.
7. Bind an isolated `PURCHASE_QUEUE`, consumer retry configuration, `AI`, and
   `PurchaseAgent` Durable Object. Configure Upstash for legacy idempotency paths.
   Use separate Razorpay test keys/webhook secret if testing that rail.
8. In Vercel set project root `apps/web` and build-time
   `NEXT_PUBLIC_INTENTLOCK_API_URL` to the HTTPS preview Worker origin. Set
   `BUILD_GIT_SHA` on the Worker to the exact tested commit, and
   `BUILD_ENVIRONMENT=preview`. Compare Worker `/health.gitCommit` with frontend
   `/api/build-info.gitCommit`; null means unconfigured, not correlated.

Inspect `/api/payments/provider` for `paypalReadiness.missing` and `issues`.
`ready: true` means configuration shape only; it does not prove valid credentials,
database access, queue health, merchant authorization or provider availability.
`NO_PAYMENT_RAIL_AVAILABLE:USD:paypal[PAYPAL_NOT_CONFIGURED]` requires correcting
the deployed OAuth settings, not disabling rail selection or recipient checks.

## Optional external services

Shopify requires its configured store domain and authorized Storefront token;
eBay requires the matching environment's client credentials and API approval.
The global Shopify catalog is explicitly feature flagged. These are discovery
connectors, not authorized merchant payment/fulfillment connections.

WAHA requires `WAHA_BASE_URL`, `WAHA_API_KEY`, session configuration, ingress
signature secret and pairing configuration as defined by `whatsapp/routes.ts`.
Pair the intended user, create explicit wallet grants and test inbound replay
rejection and outbound delivery. Never expose WAHA or payment secrets in the web
bundle. Future voice/agent channels must use the same authenticated session API.

## Rollback

Retain previous tested web and Worker artifacts and their matching source SHA.
Pause new execution through operational access controls if integrity is uncertain.
Roll back application artifacts after checking schema compatibility; keep ledger,
provider evidence, reservations and audit history intact. Recover pending payments
only through verified-evidence reconciliation. Never repair a release by deleting
financial rows, releasing an uncertain capture reservation, or issuing a second
provider transaction. Database changes need a reviewed forward repair plan.
