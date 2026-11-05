# PayPal sandbox integration and release verification

## Runner diagnosis and safe failure handling

The old runner's first operation after `SANDBOX` was `POST /api/access/demo`.
This writes a short-lived capability to the financial database; it is not a
read-only OAuth check. A failure there occurs before any provider request.
The old catch discarded its HTTP status and exception, so historical generic
output cannot establish whether issuance failed with 401/403 (access), 429
(issuance limits), 503 (disabled access/database/schema), or transport/TLS failure.
Do not issue capabilities just to diagnose an environment when only read-only
inspection is authorized. The corrected runner reports `demo_capability` and a
closed-vocabulary code plus HTTP status. `ACCESS_CONTROL_UNAVAILABLE` can mean
missing DB configuration, connectivity, or missing financial-access migrations;
it deliberately does not expose database error text. Inspect authorized server
logs/schema separately. Do not change financial records to manufacture success.

The old result object did not itself prove the failure was pre-OAuth: its oauth
field was never updated at all, and it logged session/wallet IDs only after order
creation. The same all-NOT_TESTED output could arise at capability issuance,
wallet/session creation, selection/binding checks, order creation (including
provider OAuth), or approval URL validation. If independent operator evidence
establishes pre-OAuth failure, the module-loader defect is still separate: the
interactive runner never invoked sourceModule or the local OAuth helper. The
exact historical failing request cannot be reconstructed from that output alone.
The repaired runner logs session IDs as soon as available and distinguishes each
stage. During order creation it reports OAuth as not independently observed,
rather than incorrectly saying it was never attempted.

The local OAuth helper had a separate reproducible implementation defect:
`paypal.ts` imports `wallets/validation.ts`, which imports the bare package `zod`.
Transpiling relatives into data URLs left `zod` unresolved, causing Node's
`ERR_UNSUPPORTED_RESOLVE_REQUEST` before OAuth. The loader now resolves installed
packages from the original source file and keeps source compilation in memory.
The helper checks local credential presence first, then invokes the real provider
implementation against the real sandbox OAuth endpoint. Deployed Cloudflare
secrets do not populate local environment variables. Never copy credentials into
command arguments, logs, source, or a terminal transcript.

Diagnostics contain stage, allowlisted code, HTTP status and (when supplied by
the corrected Worker) provider HTTP status. Unknown exceptions, provider bodies,
database errors, stacks and authorization values are suppressed. The setup helper
preserves the preceding safe diagnostic instead of replacing it with a generic
failure. OAuth transport and module-loading failures have separate codes; a
401/403 from OAuth is a real provider rejection, while one from the Worker is an
access failure. A ready configuration does not attest either operation.

The runner now validates local dedicated demo configuration before network work,
requires a valid capability with a short future expiry, checks exactly USD 49,
and validates the buyer return origin, session and order token before the
separate AUTHORIZE confirmation. The return is correlation only; server/provider
checks remain authoritative. A capability expiring during buyer approval stops
the run; do not bootstrap a new identity and retry an ambiguous capture.

After capture, the runner requires verified HMAC/recipient proof bound to the
same wallet/session/order and USD 49 ledger entry, a COMMITTED reservation and
zero reserved balance. COMMITTED means reserved authority was converted into the
single ledger debit. It checks stable receipt/ledger identity after the explicitly
confirmed duplicate capture request. It never resends captures after a transport
failure, nor sends synthetic webhooks.

Exit 1 means stopped/blocked; diagnostics identify the last stage. Exit 2 after
successful financial observations means the complete E2E evidence is still
pending: queue consumer acknowledgment and actual original-provider webhook
redelivery are manual checks. `ok` from the injectable test function describes
financial observations only; `complete` remains false. A final CAPTURED status
does not establish queue acknowledgment. Configuration readiness also uses exit
2 when blocked. Do not interpret any of these as a genuine full E2E pass.

On Windows with npm.ps1 disabled, use `npm.cmd` without changing execution policy.
The Worker has no `build` script; `npm.cmd --workspace apps/worker run dry-run:demo`
is its available Wrangler bundle verification. The standalone OAuth helper is
`node apps/worker/scripts/sandbox-tools.mjs oauth`, after securely supplying
`PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET` in that process.

For the first authorized real run, verify database/queue isolation and merchant
authorization, inspect the deployed source SHA, and run:

```powershell
npm.cmd --workspace apps/worker run check:demo
npm.cmd --workspace apps/worker run check:paypal
node apps/worker/scripts/sandbox-tools.mjs oauth
npm.cmd --workspace apps/worker run test:sandbox -- --interactive
```

Only the last command creates financial resources. Type SANDBOX only when that
work is authorized. Open its returned sandbox checkout with a separate buyer,
paste the actual buyer return URL into the CLI without terminal recording, then
confirm AUTHORIZE and CAPTURE 49.00 USD separately. Approve REPLAY only after
verified settlement. Retain session/receipt/ledger identities in controlled
operator evidence. Correlate original verified webhook evidence with the hosted
202 enqueue response and consumer acknowledgment for the same payload hash.
If a capture response is lost or settlement times out, preserve the reservation
and investigate the existing transaction; never rerun the lifecycle blindly.

Under separate permission, use PayPal's original-event resend facility to
redeliver the same authenticated capture event, then use the owning capability
to read session/payment/proof/wallet again. Require identical capture,
receipt and ledger IDs, USD 49 spent, zero reserved, and no second ledger debit;
collect queue acknowledgment logs for the redelivery. The runner intentionally
leaves webhookReplay and queue pending until that external evidence is reviewed.
Never fabricate transmission headers or equate a capture replay with a webhook
replay. No local mocked regression establishes real provider verification.

This runbook is for `intentlock-worker-demo` only. Never deploy the tracked
production Wrangler configuration. No command here automatically deploys,
merges, migrates a database, captures, refunds, or changes financial records.

## Configuration and secure operator setup

From repository root, install the locked dependencies with `npm ci`. The setup
uses the repository Wrangler, not an unpinned download or global installation.
The local, untracked `apps/worker/wrangler.demo.jsonc` must name exactly
`intentlock-worker-demo`, specify sandbox, and bind both producer and consumer to
`intentlock-purchase-jobs-demo`. Environment overrides and inline PayPal settings
are rejected. Keep this file untracked. The guard checks local configuration;
Cloudflare account ownership, deployed queue bindings, consumer health, Neon
branch, Redis isolation and Durable Object namespace still need operator review.

Windows PowerShell **5.1**:

```powershell
powershell.exe -NoProfile -File apps/worker/scripts/setup-paypal-sandbox.ps1 -CheckOnly
powershell.exe -NoProfile -File apps/worker/scripts/setup-paypal-sandbox.ps1
```

If your workstation disallows scripts, have the operator follow its script policy.
Validation used `-ExecutionPolicy Bypass` on a single child PowerShell process;
no machine or user policy was changed. Do not use shell transcription or diagnostic
tracing while entering credentials. Prompts use SecureString; plaintext necessarily
exists briefly in process memory and stdin to Wrangler, never in arguments or
files. The script configures only absent secret names. To rotate a present but
invalid value, use the same guarded helper's `put` command with securely supplied
stdin; absence and invalidity are different states. Partial setup can be resumed.

Obtain these values outside this repository:

| Setting | Genuine source / validation |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Developer Dashboard, sandbox REST app owned by the intended business account; never live keys |
| `PAYPAL_WEBHOOK_ID` | Sandbox app webhook registration for `https://intentlock-worker-demo.shdixit10.workers.dev/webhooks/paypal` |
| `PAYPAL_RETURN_BASE_URL` | `https://intentlock-web.vercel.app`, origin only; no path, query, credentials or fragment |
| `PAYPAL_ACCOUNT_MERCHANT_ID` | Actual sandbox business merchant account ID associated with the app; shape is 13 permitted uppercase PayPal characters |
| `PAYPAL_MERCHANT_BINDINGS_JSON` | Explicitly authorized registry built by the protected setup prompts |

Register the authorization, capture completed/pending/denied/refunded and dispute
events used by the application. Use the app's actual webhook registration ID.
Simulator events do not establish real checkout or postback signature verification.
Use a separate sandbox personal buyer account for approval.

The merchant helper asks for existing legal merchant, checkout merchant, mapping
and approval references plus a future expiry. Only represent a synthetic seller
the business has explicitly authorized (`audiohub-sandbox` for the USD 49 Sony
flow). These are catalog keys, not PayPal account IDs. It validates with the actual
`recipient-binding.ts` module in memory, checks account equality, sandbox/direct
merchant scope and catalog eligibility. It does not establish that an approval
reference is legally valid or that OAuth belongs to that account. Never paste
synthetic test IDs or invent approval evidence. Partner onboarding is unsupported.

`APPROVAL_SIGNING_SECRET` (24+ random characters), isolated `DATABASE_URL`, scoped
access and exact CORS origins are also required; this script does not rotate or
change them. Their presence must not be treated as a health check.

## Four separate verification levels

1. `setup-paypal-sandbox.ps1 -CheckOnly`: Wrangler names only, **presence**.
2. `npm --workspace apps/worker run check:paypal`: public, secret-free deployed
   configuration **shape**, missing names, issues and full SHA comparison.
3. Explicit **read-only sandbox OAuth**, from an operator process that already has
   securely supplied sandbox environment variables:
   `node apps/worker/scripts/sandbox-tools.mjs oauth`. Requires
   `PAYPAL_ENV=sandbox`. Never prints the access token. Success validates the
   OAuth pair; it does not validate recipient authority, webhook ID or payments.
4. `npm --workspace apps/worker run test:sandbox -- --interactive`: **real sandbox**
   buyer approval, authorization, capture, authenticated webhook and settlement.
   Running without `--interactive` is a readiness-only gate and exits nonzero
   without preparing a purchase. The runner holds its capability only in memory.

## Current API contract

All financial API routes require the owning demo capability or a properly scoped
API identity and resource grant. Demo clients obtain a short-lived capability
through `POST /api/access/demo`; send `Authorization: Bearer <capability>` and a
fresh `x-intentlock-request-id` for each mutation. Never reuse a browser return
query as payment evidence or pass privileged operations tokens to the frontend.

| Step | Endpoint / result |
|---|---|
| Wallet | `POST /api/wallets` with explicit policy; returns `wallet` |
| Session | `POST /api/sessions` with walletId, `paypal-demo-marketplace`, prompt, channel `WEB`; returns `session` |
| Deterministic selection | `POST /api/sessions/:id/run`; Sony `pp_sony_49`, USD 49, `ALLOW`, trusted bound recipient |
| Checkout | `POST /api/sessions/:id/payment`; returns `payment.providerOrderId`, `checkoutUrl`, duplicate flag; reserves authority |
| Buyer approval | Open returned sandbox URL, approve with sandbox buyer; return `/new-purchase?paypal=approved&sessionId=...` also carries PayPal token/PayerID |
| Authorize | `POST /api/sessions/:id/payment/authorize`; server validates order/recipient/policy; only places a hold |
| Capture | `POST /api/sessions/:id/payment/capture`; final amount and policy recheck; response is untrusted for settlement |
| Authenticated webhook | `POST /webhooks/paypal` with original PayPal transmission headers/body; provider signature postback must return SUCCESS |
| Settlement | Evidence persisted before enqueue; `FINALIZE_PAYPAL_CAPTURE` carries evidence hash only; consumer reloads evidence and verifies recipient/order/auth/capture |
| Observe | `GET /api/sessions/:id`, `/payment`, `/proof`, `GET /api/wallets`; CAPTURED and valid signature/recipient proof required |

Real runner confirmations occur separately before authorization, USD 49 capture
and duplicate capture replay. It never opens a live URL or sends fake webhooks.
Buyer browser return does not have the CLI's capability: return to the CLI after
approval. Do not initiate another purchase in that browser. Keep the CLI alive.
On interruption record the session ID and use an authorized operator recovery
path; do not automatically create or repeat a capture.

Capture completion requires original authenticated webhook evidence, exact order,
authorization, capture, amount and currency. Missing linkage is quarantined rather
than guessed. A persisted observation and SQL checks bind receiving merchant and
wallet. Settlement SQL locks authority and inserts a unique spend record before
proof generation. A queue retry repairs later stages without a second debit.
Proof is HMAC signed with audit head and recipient evidence; public verification
checks the persisted proof. The runner's proof verification is server-side;
independent offline HMAC verification would require the server signing secret.

Queue success cannot be established from the final status alone because source
supports a local synchronous fallback. For a hosted run, record the 202 enqueue
response and Cloudflare consumer/ack logs with the same payload hash, queue name,
retry count and session ID. The runner leaves queue verification pending operator
logs. Five retries are configured locally; no DLQ is configured. After exhaustion,
preserve evidence and have an operator redeliver the original provider event or
recover the persisted job; do not release an ambiguous capture reservation.

## Failure and replay matrix

`npm test` is an isolated **mock-provider** and disposable SQL regression suite,
not real PayPal verification. Reproduce external failures only in a separate
disposable sandbox deployment/database, with operator-controlled fault injection.
Never run destructive fault injection against the demo shared by other users.

| Case | Existing/new isolated coverage | Real sandbox procedure and expected result |
|---|---|---|
| Missing credentials | payment-readiness, paypal-commerce | Check-only/readiness exits blocked, zero order requests |
| Invalid client secret | paypal-sandbox-hardening | Explicit OAuth probe with an invalid in-memory sandbox secret: failure, no token output; do not replace a working deployed secret |
| Wrong merchant identity | recipient-registry, recipient-settlement-sql | In isolated deployment, authorized mapping/account mismatch must fail before order; correct shape alone is insufficient |
| Unsupported currency | paypal, payment capability suites | Isolated INR transaction must reject PayPal; no rail bypass |
| Expired wallet / quote | wallet-reservations-sql, paypal-commerce, fx | Create a short-lived policy/quote, wait for natural expiry before payment/authorize/capture; fail closed |
| Invalid return URL | payment-readiness | Setup `put` rejects HTTP non-local/path/query origins before Wrangler mutation |
| Duplicate capture | paypal-commerce, reservations SQL | Runner explicitly offers duplicate replay after settlement; duplicate=true and wallet stays USD 49 |
| Duplicate webhook | paypal-finalization, release-http-integration | Operator resends same real PayPal event; proof/ledger identity and USD 49 debit remain unchanged |
| Delayed webhook | paypal-late-capture | Delay delivery on disposable infrastructure; reservation persists, deliver original authenticated event, settle once |
| Missing webhook | paypal-commerce, finalization | Withhold delivery in disposable setup; no CAPTURED/proof; runner times out without retrying capture |
| Queue retries | purchase-queue, paypal-finalization | Operator temporarily blocks isolated consumer, restores it, observes redelivery/ack and one debit |
| Database failure | paypal-repository, paypal-finalization | Operator interrupts only disposable DB access at evidence/settlement/proof stages; retries preserve authority and one debit |
| Ambiguous capture | release-http-integration, reservations | Disposable proxy drops capture response after provider acceptance; no automatic recapture; original webhook recovers once |
| Unauthorized access | financial-access, financial-access-sql, release-http-integration | Separate ungranted capability cannot read/mutate wallet/session; unauthorized requests create no provider transaction |
| Refund replay | paypal-post-purchase, refund-reliability / refund-ledger-sql | Authorized ops identity evaluates then explicitly requests sandbox refund, syncs provider truth, repeats same logical refund/sync; one provider refund and one wallet credit |

The runner automates the happy path and capture duplicate assertion. Manual
fault-injection rows require operator evidence and are **not automated real
sandbox tests**. No real external failure matrix was executed in this release.
Never adjust financial rows to manufacture any expected state. Refund routes are
privileged (`/api/trust-center/refunds/evaluate/:session`, `/request/:session`,
`/:refund/sync`); do not elevate the demo capability. Reconciliation uses provider
reads and verified evidence; missing webhook capture truth alone cannot mint proof.

## Exact source metadata and release

```powershell
npm --workspace apps/worker run typecheck
npm --workspace apps/worker run dry-run:demo
node apps/worker/scripts/sandbox-tools.mjs release-args
```

The last command refuses dirty tracked source and prints, but never executes, a
demo-only deploy command with full HEAD `BUILD_GIT_SHA` and
`BUILD_ENVIRONMENT:preview`. Review untracked dependencies and commit all release
source first. Execute a reviewed deployment only under a separate operator action.
The dry-run marks dirty source nondeployable and is not evidence of deployed SHA.
Configure Vercel from that same source commit. Compare full hexadecimal Worker
`/health.gitCommit` and frontend `/api/build-info.gitCommit`; null, invalid, unequal
or merely equal version strings do not establish a match. A matching SHA also
does not prove credential validity or hosted resource isolation.

Primary PayPal references: [Orders/authorization](https://developer.paypal.com/whats-an-order/),
[webhook integration and signature postback](https://developer.paypal.com/api/rest/webhooks/rest/),
[simulator limitations](https://developer.paypal.com/api/rest/webhooks/simulator/).
