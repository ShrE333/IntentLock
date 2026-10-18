# PayPal webhook finalization repair

The local V11 settlement function declared an output parameter named spent_amount and used the same unqualified name in UPDATE intent_wallets SET spent_amount=spent_amount+p_amount. PostgreSQL raises 42702 (ambiguous column reference). The function call rolls back, but the earlier webhook claim remains committed. The old handler then acknowledges retries as duplicates without finishing settlement.

The SQL regression test reproduces 42702 and verifies rollback before applying the repair. The deployed function could not be inspected: the read-only Neon request failed with fetch failed. No live transaction data was changed.

The repair qualifies the wallet column and locks the wallet before checking its unique session ledger. Existing debits reconcile before expiry/status checks, with wallet, amount, currency, provider, order and capture identity checked against the ledger. New debits retain the existing authority checks.

Verified capture deliveries are persisted and queued through PURCHASE_QUEUE. A claim records receipt, never settlement completion. The consumer reloads the stored verified evidence and expected payment, validates identifiers and money, then reconciles the wallet debit, captured states and signed receipt. A retry exits as finalized only when both captured records and the attached proof exist. Queue delivery failures return HTTP 500; settlement errors retry through the existing queue policy (five retries). Evidence remains in session_payment_webhook_events after queue retries are exhausted, so resending the same PayPal event safely resumes processing.

Captured state cannot be downgraded by late PayPal authorization/capture responses or denial events. The first saved proof is immutable, and retries repair a missing session proof link. Browser redirects and capture API responses still cannot finalize payment.

## Deploy and recover the existing transaction

Run from PowerShell with Node 22+ and the existing apps/worker/.dev.vars pointing to the intended database and PayPal environment. Neither command prints credential values.

```powershell
Set-Location D:\IntentLock\apps\worker
node --env-file=.dev.vars scripts/paypal-settlement.mjs apply-fix
if ($LASTEXITCODE -ne 0) { throw 'Settlement migration failed' }
npm run deploy
if ($LASTEXITCODE -ne 0) { throw 'Worker deployment failed' }
node --env-file=.dev.vars scripts/paypal-settlement.mjs resend WH-2FL82343PG4519108-99T21290FR210705F 4Y801583L6903863E
```

The migration only replaces the SQL function. It does not alter existing payment records, manually mark sessions captured, or clear webhook claims. The resend operation calls PayPal's POST /v1/notifications/webhooks-events/{event_id}/resend with webhook_ids, using the existing event; it creates no order, authorization or capture. API reference: https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/notifications_webhooks_v1.json

After the queued settlement completes, verify:

```powershell
$base = 'https://intentlock-worker.shdixit10.workers.dev'
$id = 'ps_dd03ce0a-6370-485d-a2e1-a9ba44ca2f90'
(Invoke-RestMethod "$base/api/sessions/$id").session | Select-Object sessionId,status,capturedAmount,capturedCurrency,capturedAt,proofReceiptId
Invoke-RestMethod "$base/api/sessions/$id/payment"
Invoke-RestMethod "$base/api/sessions/$id/proof" | ConvertTo-Json -Depth 20
```

Expected: CAPTURED, capturedAmount 49, capturedCurrency USD, a capture timestamp and proof receipt ID; payment provider paypal with capture 5PU61935DJ588835L; proof verification reports a valid audit chain. A resend response only confirms dispatch acceptance, so allow the queue time to run before checking.

## Local validation

Run npm test at the repository root. The suite includes real isolated PostgreSQL execution through PGlite, webhook failure/retry tests, queue consumer tests, repository state/proof recovery tests, and the existing Razorpay suite. These tests never connect to Neon or PayPal.

Run npx tsc --noEmit -p apps/worker/tsconfig.json at the root. Existing decorator, request generic, BufferSource, authorization response and queue shortUrl typing errors remain outside this fix; no new settlement test/source type errors remain. The Worker bundle can be verified without publishing by running npx wrangler deploy --dry-run --outdir .wrangler/paypal-settlement-dry-run in apps/worker.

Final validation: 132 tests passed across 29 files; Wrangler deployment dry run and recovery helper syntax check passed. Worker type checking still reports 17 pre-existing errors in the categories listed above.
