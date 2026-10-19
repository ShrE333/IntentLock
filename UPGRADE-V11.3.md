# Upgrade to IntentLock V11.3

Apply this patch on top of the repository where V11.1 eBay, V11.2 TrustOps, and V11.2.2 End-to-End UX have already been extracted.

## 1. Extract

Extract the ZIP into:

`D:\IntentLock`

Choose **Replace files in destination**. Do not delete `.git`, `.dev.vars`, `node_modules`, or existing SQL migrations.

## 2. No database migration

V11.3 requires no SQL migration and no new secret.

## 3. Run the regression suite

```powershell
cd D:\IntentLock
npm test
```

V11.3 adds 10 tests. The exact total can differ if your working tree has additional tests; the requirement is that all tests pass.

Then verify the Worker bundle without publishing:

```powershell
cd D:\IntentLock\apps\worker
npx.cmd wrangler deploy --dry-run --outdir .wrangler\v11-3-dry-run
```

## 4. Important: create/select a usable wallet

V11.3 intentionally refuses to create new purchase sessions from:

- expired wallets
- revoked wallets
- wallets with zero remaining authority
- wallets with less than 15 minutes validity remaining

Open:

`http://localhost:3000/wallets`

The UI now shows `READY`, `EXPIRED`, or `REVOKED` next to each wallet.

For a clean demo, create a fresh wallet. The UI defaults to 72 hours validity; change it if desired.

## 5. Start the apps

Worker:

```powershell
cd D:\IntentLock
npm run dev:worker
```

Web:

```powershell
cd D:\IntentLock
npm run dev:web
```

Open:

`http://localhost:3000/new-purchase`

## 6. What should be different

For the prompt:

`Find me Sony wireless ANC headphones. Buy automatically if allowed.`

Session Trace should contain:

- `USER_INTENT_RECEIVED`
- `SEARCH_STARTED`
- `DISCOVERY_QUERY_PLANNED`
- `PRODUCT_FOUND`
- optional `PAYEE_IDENTITY_BOUND`
- optional `FX_QUOTE_BOUND`
- `POLICY_DECISION`
- `CANDIDATE_SELECTED` or an explicit stop reason

`DISCOVERY_QUERY_PLANNED` should show approximately:

`Sony wireless ANC headphones`

The marketplace search is no longer silently filtered by the wallet's allowed brands/categories/features. Those rules are evaluated after products return.

## 7. PayPal pending-state fix

When a session reaches `READY_TO_PAY`, click **Create Authorized Checkout**.

V11.3 redirects the current tab to PayPal instead of opening a popup after awaited calls. After buyer approval, PayPal returns to New Purchase and IntentLock runs:

`PAYPAL_APPROVAL_PENDING -> AUTHORIZED -> CAPTURE_PENDING -> CAPTURED`

The final `CAPTURED` transition still requires the verified provider webhook and wallet settlement.

If an older session is already stuck:

- `PAYPAL_APPROVAL_PENDING`: use **Resume PayPal Approval**
- `AUTHORIZED`: use **Resume Safe Capture**
- `CAPTURE_PENDING`: open **Inspect Transaction** and run a deep provider scan if it becomes stale

## 8. eBay remains safe to leave unconfigured today

Until eBay approves the application, IntentLock will prefer an enabled live connector if one exists and otherwise fall back to the PayPal demo marketplace.

Once `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` are configured, New Purchase prefers the live eBay connector automatically. V11.3 also preserves the eBay environment through PurchaseSession execution so discovery and payment-time revalidation use the same connector configuration.

## 9. Demo catalog vs hard-coded policy

The built-in Demo / PayPal Sandbox Marketplace contains deterministic fixture products by design. It is only a data source for testing.

The transaction outcome is not hard-coded. It is calculated from:

- selected wallet status and expiry
- remaining authority
- hard ceiling / auto-buy limit
- brand/category/features
- normalized FX amount
- merchant country
- PayeeLock identity
- live/current commerce facts on revalidation
- payment provider capability

The new `policy-decision-dynamics.test.ts` proves that the exact same product becomes ALLOW, STEP_UP, or BLOCK when wallet data changes.
