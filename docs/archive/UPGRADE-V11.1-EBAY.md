# IntentLock V11.1 — eBay Browse Upgrade

This ZIP is an incremental patch for the working V11.0.3 baseline.

## 1. Extract over the existing repository

Extract the ZIP directly into:

```text
D:\IntentLock
```

Allow Windows to replace files with the same names. Do not delete `.git`, `.dev.vars`, `node_modules`, or existing database migrations.

There is **no database migration** in V11.1.

## 2. Get eBay developer credentials

Create/use an eBay Developer Program application and obtain the Client ID and Client Secret for the environment you want to use.

Sandbox and Production credentials are separate. The Browse connector uses an Application access token minted with the OAuth client-credentials grant.

## 3. Add local eBay configuration

Merge this into `apps/worker/.dev.vars` without replacing your existing PayPal, Neon, signing, Razorpay or FX values:

```dotenv
EBAY_ENV=sandbox
EBAY_CLIENT_ID=YOUR_EBAY_SANDBOX_CLIENT_ID
EBAY_CLIENT_SECRET=YOUR_EBAY_SANDBOX_CLIENT_SECRET
EBAY_MARKETPLACE_ID=EBAY_US

# Optional buyer context used by eBay for more accurate delivery/shipping context:
# EBAY_ENDUSER_COUNTRY=US
# EBAY_ENDUSER_POSTAL_CODE=95008
```

For real production listings use your Production eBay keys and:

```dotenv
EBAY_ENV=production
```

Never commit `.dev.vars` or the eBay Client Secret.

## 4. Smoke-test eBay before starting IntentLock

From PowerShell:

```powershell
cd D:\IntentLock\apps\worker
node --env-file=.dev.vars scripts/ebay-smoke.mjs "Sony wireless ANC headphones"
```

Expected shape:

```json
{
  "ok": true,
  "environment": "sandbox",
  "marketplace": "EBAY_US",
  "count": 1,
  "items": []
}
```

The actual item count depends on the eBay environment/catalog. Sandbox inventory can be sparse; Production Browse is the better live-demo source once you have Production application keys.

## 5. Run the regression suite

```powershell
cd D:\IntentLock
npm test
```

Your committed baseline had 167 passing tests before this patch. V11.1 adds six eBay connector tests, so a clean baseline should be around 173 tests, although the exact total can differ if you add more tests locally. The requirement is that **all tests pass**.

Then verify the Worker bundle:

```powershell
cd D:\IntentLock\apps\worker
npx wrangler deploy --dry-run --outdir .wrangler/v11-1-ebay-dry-run
```

## 6. Run locally

Worker:

```powershell
cd D:\IntentLock
npm run dev:worker
```

Web app in another terminal:

```powershell
cd D:\IntentLock
npm run dev:web
```

Open the Commerce or Autonomous Purchase page. Once the credentials are valid, the connector list will contain:

```text
eBay Browse · EBAY_US
```

Select it and search for a real listing.

## 7. Deploy eBay configuration to Cloudflare

From `D:\IntentLock\apps\worker`:

```powershell
npx wrangler secret put EBAY_CLIENT_ID
npx wrangler secret put EBAY_CLIENT_SECRET
npx wrangler secret put EBAY_ENV
npx wrangler secret put EBAY_MARKETPLACE_ID
```

Enter the same values used locally. Optional buyer-context values can also be stored as Worker secrets:

```powershell
npx wrangler secret put EBAY_ENDUSER_COUNTRY
npx wrangler secret put EBAY_ENDUSER_POSTAL_CODE
```

Then deploy:

```powershell
npm run deploy
```

## 8. What V11.1 does during a purchase session

```text
Agent goal
  ↓
eBay Browse search (FIXED_PRICE)
  ↓
getItem for structured listing facts
  ↓
IntentLock maps:
  seller + item country + price/currency + taxonomy + structured aspects
  ↓
merchant prose stays UNTRUSTED
  ↓
FX normalization
  ↓
wallet policy
  ↓
selected listing
  ↓
payment-time eBay getItem refresh
  ↓
quote/policy/FX revalidation
  ↓
existing PayPal or Razorpay capability selection
  ↓
verified settlement + proof
```

If eBay changes the price or other authorization-bound facts, IntentLock's existing `COMMERCE_QUOTE_CHANGED_REAUTHORIZE` path stops payment and requires new authorization.

## 9. Important eBay boundary

This release deliberately does **not** call eBay Order API. eBay Browse is the catalog/discovery and revalidation source; the existing PayPal checkout is still the IntentLock payment-rail demonstration. Do not describe the PayPal capture as an eBay order fulfillment.

A later version can add eBay checkout only after the required eBay Buy/Order API access, user-consent/checkout model and eBay UX requirements are satisfied.

## 10. Suggested commit after validation

```powershell
cd D:\IntentLock
git add -A
git commit -m "feat: add eBay Browse commerce connector and live quote revalidation"
git push origin main
```
