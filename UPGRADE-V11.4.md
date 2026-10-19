# Upgrade to IntentLock V11.4 — Post-Purchase Guard

Base expected: V11.3 Transaction Reliability already extracted.

## 1. Extract
Extract this ZIP into your existing IntentLock repository root and allow replacement of files:

```text
D:\IntentLock
```

Do not delete `.git`, `.dev.vars`, `node_modules`, or existing project data.

## 2. Apply the database migration
Run the complete contents of:

```text
apps/worker/db/v11_4_post_purchase_guard.sql
```

against the same Neon database used by IntentLock.

The migration is additive. It does not change or rewrite the successful PayPal capture, wallet spend ledger, or proof receipt you already have.

## 3. Configuration
Merge these non-secret settings into `apps/worker/.dev.vars`:

```dotenv
REFUND_MAX_AGE_DAYS=30
REFUND_BLOCK_ON_OPEN_DISPUTE=true
```

Money-moving post-purchase actions use the existing V11.2 TrustOps protection:

```dotenv
TRUSTOPS_ADMIN_TOKEN=<a long random value>
```

Do not commit that token. For a deployed Worker, add the same value as a Wrangler secret instead of a plain config variable.

## 4. Why refund finalization has two phases

```text
Refund policy ALLOW
       ↓
PayPal refund POST
       ↓
PROVIDER_ACCEPTED
       ↓
Authenticated PayPal refund GET
       ↓
PayPal status == COMPLETED
       ↓
Replay-safe wallet authority restoration
       ↓
Refund evidence hash + audit events
```

A browser response and even the initial provider POST response are not allowed to credit the Intent Wallet.

## 5. Run tests

```powershell
cd D:\IntentLock
npm test
```

V11.4 adds 18 tests on top of your current suite. The exact overall test count depends on the patches already in your working tree; the requirement is that all files/tests pass.

Then validate the Worker bundle:

```powershell
cd D:\IntentLock\apps\worker
npx.cmd wrangler deploy --dry-run --outdir .wrangler\v11-4-dry-run
```

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
http://localhost:3000/post-purchase
```

The page only lists captured PurchaseSessions. Select the completed USD 49 PayPal session if you want to inspect policy behavior.

**Do not press Request approved refund on a transaction you want to preserve as your clean hackathon purchase demo.** Use a separate sandbox capture for refund testing.

## 7. Refund test sequence

1. Select a captured PayPal PurchaseSession.
2. Enter a small partial amount.
3. Click **Evaluate refund**. This is read-only.
4. Confirm the Refund Firewall says `ALLOW` and shows the wallet authority amount that would be restored.
5. For an actual sandbox refund, enter the TrustOps admin token and click **Request approved refund**.
6. Use **Sync provider truth**. Wallet authority is restored only after PayPal reports the refund `COMPLETED`.

## 8. Dispute behavior
V11.4 uses PayPal's Disputes API to discover a dispute tied to the original capture. If an unresolved dispute exists and `REFUND_BLOCK_ON_OPEN_DISPUTE=true`, Refund Firewall blocks an automatic refund to avoid refund + dispute double reimbursement.

The existing Dispute Defense evidence packet still reports missing fulfillment/delivery proof rather than inventing it. The PayPal adapter can read dispute state and can send a bounded evidence summary when the current PayPal case exposes that action. It does not automatically accept a claim or submit fake documents.

## 9. Deploy after local validation

```powershell
cd D:\IntentLock\apps\worker
npx.cmd wrangler deploy
```

If `TRUSTOPS_ADMIN_TOKEN` is not already deployed as a Worker secret:

```powershell
$token | npx.cmd wrangler secret put TRUSTOPS_ADMIN_TOKEN
```

Keep the token out of Git and chat.
