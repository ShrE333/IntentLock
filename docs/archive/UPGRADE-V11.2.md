# Upgrade to IntentLock V11.2 — TrustOps

This patch is designed to be extracted **after V11.1 eBay Integration**.

## 1. Extract

Extract the ZIP into:

```text
D:\IntentLock
```

Choose **Replace files in destination**. Do not delete `.git`, `.dev.vars`, `node_modules`, or any unrelated files.

## 2. No database migration

V11.2 does not add tables or columns. It uses the existing V11 payment, webhook, ledger, proof and audit records.

## 3. PayeeLock configuration

PayeeLock works immediately in observation mode. Add this to `apps/worker/.dev.vars` if you want to make it explicit:

```dotenv
PAYEELOCK_MODE=observe
```

Observation mode still binds the payee fingerprint and blocks a payee substitution between authorization and execution. It simply does not require the payee to be in a long-term trusted registry.

For a strict B2B/approved-seller demo later:

```dotenv
PAYEELOCK_MODE=enforce
PAYEELOCK_TRUSTED_PAYEES_JSON=[{"provider":"ebay","payeeId":"seller_username","merchantCountry":"US","label":"Approved seller"}]
```

Never use merchant prose as the payee ID. V11.2 prefers connector-provided structured identity; eBay uses the seller username.

## 4. eBay approval can remain pending

You do not need eBay credentials to continue V11.2 development. If `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` are missing, the eBay connector remains disabled and the PayPal Demo Marketplace / IntentLock Demo Marketplace continue to work.

When eBay approves the application, add the credentials and V11.1's existing connector will become active.

## 5. Tests

```powershell
cd D:\IntentLock
npm test
```

V11.2 adds seven tests: six PayeeLock tests and one read-only PayPal capture inspection test.

If your last committed V11.0.3 baseline was 167 tests and V11.1 added six eBay tests, the expected total is approximately 180 tests. The exact total can differ if your local branch has additional tests; the requirement is that every test passes.

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
http://localhost:3000/trust-center
```

Optional API smoke test:

```powershell
cd D:\IntentLock\apps\worker
node scripts/trustops-smoke.mjs http://localhost:8787
```

## 7. Recommended demo flow

1. Create/use an Intent Wallet.
2. Run an autonomous purchase through PayPal Demo Marketplace while eBay credentials are pending.
3. Open Trust Center.
4. Show the PurchaseSession as HEALTHY after settlement.
5. Click **Deep PayPal scan** to compare provider and internal state.
6. Generate an `UNAUTHORIZED_TRANSACTION` dispute evidence packet for the captured session.
7. Show the original user prompt, wallet authority, provider capture, wallet ledger, proof receipt and audit validity in one packet.
8. Show PayeeLock's bound merchant fingerprint.

When eBay is enabled, repeat the same demo with a real eBay listing; the payee fingerprint will bind the eBay seller identity and `getItem` will revalidate it before payment.

## 8. Optional protected reconciliation

The dashboard itself is read-only. To enable the manual recovery endpoint in production, store a secret:

```powershell
cd D:\IntentLock\apps\worker
npx wrangler secret put TRUSTOPS_ADMIN_TOKEN
```

Then a trusted operator can run the included CLI with the same secret available locally as an environment variable:

```powershell
$env:TRUSTOPS_ADMIN_TOKEN="<same-secret>"
node scripts/trustops-reconcile.mjs `
  https://intentlock-worker.shdixit10.workers.dev `
  ps_YOUR_SESSION_ID
```

Do not expose this token in the Next.js frontend.

## 9. Safe reconciliation invariant

The Trust Center reconciliation action is deliberately narrow:

```text
stored signature-verified PayPal capture webhook
             ↓
reload exact session + payment identity
             ↓
existing idempotent settlement function
             ↓
ledger / session / proof recovery
```

It never creates a new PayPal order, authorization or capture.

## 10. Deploy

Worker:

```powershell
cd D:\IntentLock\apps\worker
npm run deploy
```

Frontend: deploy your existing Next.js app as before. Ensure `NEXT_PUBLIC_INTENTLOCK_API_URL` points to the deployed Worker.

No new secrets are required for the read-only Trust Center. `TRUSTOPS_ADMIN_TOKEN` is required only if you enable the protected manual reconciliation endpoint. `PAYEELOCK_MODE` and the optional trusted-payee registry are configuration, not payment credentials.
