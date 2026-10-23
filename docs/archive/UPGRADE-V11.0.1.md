# IntentLock V11.0.1 — Multi-Currency + Multi-Country Upgrade

This ZIP is an **incremental patch on top of V11.0 Day 1**. Your current V11.0 PayPal AUTHORIZE → CAPTURE flow remains intact.

## What changed

IntentLock no longer treats wallet currency as payment-rail currency.

Example:

```text
Buyer / Intent Wallet: IN · INR 10,000
Merchant quote:        US · USD 49.00
                         ↓
IntentLock FX quote:   USD 49.00 → INR 4,091.50 (demo-static rate)
                         ↓
Policy evaluates:      INR 4,091.50
                         ↓
Payment capability:    PayPal can present USD? seller account accepts USD?
                         ↓
PayPal charges:        USD 49.00
                         ↓ verified webhook
Wallet ledger debits:  INR 4,091.50 exactly once
                         ↓
Proof receipt stores BOTH sides + FX quote + countries
```

The authorization hash binds presentment amount/currency, wallet amount/currency, buyer country, merchant country, FX quote ID/rate/source/timestamps, product facts and policy context.

## 1. Extract over your existing V11.0 repo

From Windows Explorer, extract this ZIP into:

```text
D:\IntentLock
```

Allow it to replace files with the same names.

Do **not** delete `.git`, `.dev.vars`, `node_modules`, or your existing project files.

## 2. Run the new Neon migration

Run the complete contents of:

```text
apps/worker/db/v11_0_1_multi_currency.sql
```

in the Neon SQL Editor.

It only adds `country_code` to `intent_wallets`. Existing wallets become `IN` by default and remain usable.

## 3. Merge these non-secret settings into `apps/worker/.dev.vars`

Keep all your existing database, signing, PayPal and Razorpay secrets.

For the first stable cross-currency demo:

```dotenv
PAYMENT_PROVIDER=auto
PAYMENT_PROVIDER_ORDER=paypal,razorpay

FX_PROVIDER=static
FX_QUOTE_TTL_SECONDS=1800
FX_REVALIDATE=false
FX_MAX_DRIFT_BPS=100
```

Set the connected PayPal **seller account** country, not the buyer country:

```dotenv
PAYPAL_ACCOUNT_COUNTRY=US
```

If you know exactly which currencies that PayPal seller account accepts, declare them explicitly:

```dotenv
PAYPAL_ACCEPTED_CURRENCIES=USD
```

Later, after enabling/confirming more currencies on that seller, expand it, for example:

```dotenv
PAYPAL_ACCEPTED_CURRENCIES=USD,EUR,GBP,SGD,AUD,CAD,JPY
```

Do not claim support in this variable for a currency the actual PayPal seller rejects.

For Razorpay keep, at minimum:

```dotenv
RAZORPAY_ACCOUNT_COUNTRY=IN
RAZORPAY_ACCEPTED_CURRENCIES=INR
```

For a Shopify/HTTP connector that does not return a merchant country, optionally set:

```dotenv
COMMERCE_MERCHANT_COUNTRY=US
```

The built-in multi-currency sandbox catalog already supplies merchant country per product.

### Optional FX modes

`FX_PROVIDER=static` is deterministic for the hackathon and intentionally appears in proof receipts as `DEMO_STATIC`.

You can override demo rates without changing code:

```dotenv
FX_RATES_JSON={"USD":1,"INR":83.5,"EUR":0.92,"GBP":0.78,"SGD":1.35}
```

A live public quote mode also exists:

```dotenv
FX_PROVIDER=frankfurter
FX_REVALIDATE=true
FX_MAX_DRIFT_BPS=100
```

Use the static mode first so payment/debugging is deterministic. Do not describe `DEMO_STATIC` as a live market FX rate.

## 4. Important: your current India PayPal sandbox seller

The error you saw — seller does not accept the transaction currency — is a PayPal seller-account capability issue, not something application code can bypass.

For a real USD sandbox E2E, either:

1. configure the PayPal sandbox Business seller to accept USD if that account/region allows it, **or**
2. use a sandbox Business seller/app whose account accepts USD (a US sandbox Business account is the simplest demo setup).

If you create/use a different PayPal sandbox app, update locally:

```dotenv
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
PAYPAL_ACCOUNT_COUNTRY=US
PAYPAL_ACCEPTED_CURRENCIES=USD
```

and update the same PayPal credentials/Webhook ID on the deployed Cloudflare Worker. Never paste these secrets into chat or commit them.

One PayPal Client ID/Secret represents one connected PayPal seller account. V11.0.1 is multi-country/currency at the authorization and capability layer; onboarding multiple independent PayPal merchants simultaneously is a separate platform/multiparty feature.

## 5. Run regression tests

From the repo root:

```powershell
cd D:\IntentLock
npm test
```

On the same baseline where V11.0 showed 25 test files / 86 tests, this patch adds nine tests, so you should see approximately:

```text
Test Files  26 passed (26)
Tests       95 passed (95)
```

If the exact total differs because your repo has additional tests, the requirement is simply: **all tests pass**.

## 6. Run locally

Terminal 1:

```powershell
cd D:\IntentLock
npm run dev:worker
```

Terminal 2:

```powershell
cd D:\IntentLock
npm run dev:web
```

Open:

```text
http://localhost:3000/wallets
```

Create this cross-currency test wallet:

```text
Name: Global Electronics
Buyer country: IN
Authority currency: INR
Total authority: 10000
Auto-buy limit: 6000
Max single transaction: 7500
Allowed categories: electronics
Allowed brands: Sony, Bose
Blocked brands: Boat
Required features: wireless, ANC
Validity: 24 hours
```

Then open:

```text
http://localhost:3000/new-purchase
```

Choose:

```text
Wallet: Global Electronics (IN · INR)
Connector: PayPal Sandbox Marketplace
```

Prompt:

```text
Find Sony wireless ANC headphones. Buy automatically if allowed.
```

With the included deterministic demo rate, the expected Sony fixture is approximately:

```text
Merchant presentment: USD 49.00
IntentLock authority: INR 4,091.50
Policy: ALLOW
Payment rail: PayPal (only if the configured PayPal seller accepts USD)
```

The UI should show an `FX_QUOTE_BOUND` event before policy evaluation and a `PAYMENT_RAIL_SELECTED` event before checkout.

## 7. What must happen after PayPal approval

```text
PAYPAL_APPROVAL_PENDING
        ↓
AUTHORIZED
        ↓
merchant quote + FX quote + wallet policy revalidated
        ↓
CAPTURE_PENDING
        ↓
verified PAYMENT.CAPTURE.COMPLETED webhook
        ↓
CAPTURED
        ↓
provider amount recorded in presentment currency
wallet amount debited in wallet currency exactly once
        ↓
Proof Receipt v1.2
```

Security invariant:

```text
PayPal order created        != CAPTURED
Buyer approved              != CAPTURED
PayPal authorization hold   != CAPTURED
Capture API returned 2xx    != CAPTURED
Verified capture webhook    == trusted transition to CAPTURED
```

## 8. Capability failure is now safe and explicit

If the merchant quote is USD but neither configured rail can accept USD, IntentLock should fail before money movement with an error similar to:

```text
NO_PAYMENT_RAIL_AVAILABLE:USD:...
```

That is intentional. “Multi-currency” means understanding and safely routing capabilities — not pretending every provider/account accepts every currency.

You can inspect a capability decision directly with:

```text
GET /api/payments/capabilities?currency=USD&walletCurrency=INR&buyerCountry=IN&merchantCountry=US
```

## 9. Cloudflare deployment

If your public Cloudflare Worker is also serving the API (not only receiving webhooks), mirror the new non-secret variables into its Variables/Secrets configuration and redeploy:

```powershell
cd D:\IntentLock
npm --workspace apps/worker run deploy
```

If you switched PayPal sandbox apps, the deployed Worker **must** also receive the new `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID`; otherwise webhook verification will use the old app credentials.

## 10. Do not commit yet

First complete:

1. `npm test`
2. INR-wallet → USD-product policy flow
3. PayPal sandbox approval
4. `CAPTURE_PENDING → CAPTURED` from verified webhook
5. Proof Receipt showing both USD presentment and INR wallet debit

Only after that should we commit the combined V11 changes.
