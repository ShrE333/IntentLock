# IntentLock V11.0 — PayPal Core Upgrade

This package is designed to be extracted **over the root of the current `ShrE333/IntentLock` repository**. It only contains files that are new or replaced in V11.0. It does **not** contain `.env` or `.dev.vars`.

## What V11.0 changes

- Adds a provider-neutral PurchaseSession payment layer.
- Adds PayPal Orders v2 with `intent=AUTHORIZE`.
- Adds the PayPal sequence: buyer approval → authorize order → IntentLock revalidation → capture authorization.
- Keeps `CAPTURED` webhook-gated. A capture API response alone does not debit the wallet.
- Adds PayPal webhook verification through PayPal's verification API.
- Adds provider-aware idempotency and replay-safe wallet spend.
- Keeps the existing Razorpay flow as a legacy/alternate rail.
- Adds `PAYMENT_PROVIDER=auto`: USD routes to PayPal, INR routes to Razorpay.
- Adds a deterministic USD PayPal Sandbox Marketplace, so the core demo no longer depends on Shopify credits.
- Keeps Shopify as an optional commerce connector.
- Makes the wallet, marketplace, purchase, and proof UIs currency/provider aware.

## 1. Back up your current work

From the IntentLock repository root in PowerShell:

```powershell
git status
git branch v10-backup
git status
```

Do not delete your existing `.dev.vars`.

## 2. Extract this package into the repository root

After extraction, paths such as the following should exist in the original repo:

```text
apps/worker/src/session-payments/providers/paypal.ts
apps/worker/db/v11_0_paypal_provider.sql
apps/worker/src/commerce/paypal-demo-connector.ts
apps/web/app/new-purchase/page.tsx
```

Allow Windows to replace files with the same names.

## 3. Run the database migration

Run the entire contents of:

```text
apps/worker/db/v11_0_paypal_provider.sql
```

against the same Neon database used by IntentLock.

The easiest option is the Neon SQL Editor. If `psql` is configured, you can alternatively run:

```powershell
psql "$env:DATABASE_URL" -f apps/worker/db/v11_0_paypal_provider.sql
```

The migration preserves existing Razorpay rows and backfills them into generic provider columns.

## 4. Add PayPal sandbox configuration to `apps/worker/.dev.vars`

Merge these variables into your existing file. Do **not** replace your existing database or signing secrets.

```dotenv
PAYMENT_PROVIDER=auto
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=YOUR_SANDBOX_CLIENT_ID
PAYPAL_CLIENT_SECRET=YOUR_SANDBOX_CLIENT_SECRET
PAYPAL_WEBHOOK_ID=YOUR_PAYPAL_WEBHOOK_ID
PAYPAL_RETURN_BASE_URL=http://localhost:3000
```

Keep existing Razorpay variables if you want the INR legacy demo to remain available.

### Important currency note

PayPal's current REST payment currency list does not include INR. V11 therefore uses a USD Intent Wallet for the real PayPal sandbox flow instead of pretending an INR PayPal payment works. INR remains supported by the existing Razorpay rail.

## 5. Configure the PayPal webhook

Create a webhook for your PayPal Sandbox app pointing to:

```text
https://YOUR-PUBLIC-WORKER/webhooks/paypal
```

Subscribe at minimum to:

```text
PAYMENT.CAPTURE.COMPLETED
PAYMENT.CAPTURE.DENIED
```

Copy the webhook's ID into `PAYPAL_WEBHOOK_ID`.

A PayPal webhook cannot call `localhost`; the webhook target must be publicly reachable. The existing Cloudflare Worker deployment is suitable.

## 6. Run tests

From the repository root:

```powershell
npm install
npm test
```

V11 adds tests for:

- PayPal currency enforcement.
- PayPal AUTHORIZE order creation.
- Authorize-order extraction.
- Payments v2 authorization capture.
- PayPal webhook verification.
- Provider-bound idempotency.
- USD demo commerce independent of Shopify.
- Untrusted merchant text remaining outside deterministic authorization.

## 7. Start locally

Terminal 1:

```powershell
npm run dev:worker
```

Terminal 2:

```powershell
npm run dev:web
```

Open the web app and first create a **USD** Intent Wallet. Suggested values:

```text
Name: PayPal Electronics
Currency: USD
Total authority: 100
Auto-buy limit: 55
Max single transaction: 75
Allowed category: electronics
Allowed brands: Sony, Bose
Blocked brands: Boat
Required features: wireless, ANC
```

Then open **Autonomous Purchase** and use **PayPal Sandbox Marketplace**.

## 8. Expected PayPal state flow

```text
READY_TO_PAY
  ↓
PAYPAL_APPROVAL_PENDING
  ↓ buyer approves on PayPal
AUTHORIZED
  ↓ IntentLock revalidates quote + policy
CAPTURE_PENDING
  ↓ only after verified PAYMENT.CAPTURE.COMPLETED
CAPTURED
  ↓
Proof Receipt
```

The important invariant is:

```text
PayPal order created        != CAPTURED
Buyer approved              != CAPTURED
PayPal authorization hold   != CAPTURED
Capture API returned 2xx    != CAPTURED
Verified capture webhook    == trusted transition to CAPTURED
```

## 9. Recommended first commit

After tests and a sandbox transaction pass:

```powershell
git add .
git commit -m "feat(paypal): add authorize-capture payment rail and verified webhook settlement"
git push origin main
```

## Rollback

Before committing, the easiest rollback is:

```powershell
git restore .
git clean -fd
```

Do not run the rollback commands if you have unrelated uncommitted files you need to keep.

The SQL migration is additive/backward-compatible and intentionally does not drop the legacy Razorpay columns.
