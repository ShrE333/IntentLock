# PayPal sandbox release readiness ? 2026-11-05

Verdict: **blocked for real sandbox lifecycle verification; NOT PRODUCTION READY**.
This report supersedes the previous local candidate gate for this repair task.
Base source: `3e607b15843613ed3c59e0ed403ed4e2d2d16367`.
Branch: `fix/paypal-sandbox-final-integration`.

## Changes and audit conclusions

- Reject invalid PayPal environments rather than silently choosing sandbox; public
  diagnostics preserve invalid values for diagnosis.
- Require a matching real demo catalog source/seller for registry readiness, using
  the catalog itself rather than an unrelated valid registry entry.
- Stop reflecting OAuth error descriptions into API errors; reject malformed
  successful access tokens.
- Reject capture/refund GET responses whose ID is absent or differs from the
  requested record. Do not turn missing identity into verified refund evidence.
- Add PowerShell 5.1 secure setup, actual-validator merchant helper, secret-name
  inventory, secret-free public readiness/SHA checker, read-only sandbox OAuth
  probe, guarded demo dry-run and operator-only exact SHA release arguments.
- Add an interactive real sandbox runner. All authorization/capture/replay steps
  require explicit operator input. It never synthesizes webhooks or alters SQL.
- Existing AUTHORIZE order, policy/quote rechecks, recipient observations,
  authenticated webhook postback, persisted-evidence queue consumer, SQL unique
  ledger debit, HMAC proof and refund idempotency protections remain enforced.

## Execution results

| Check | Observed result |
|---|---|
| Focused regressions | PASS: 4 files / 45 tests, after final tooling and catalog changes |
| Full `npm test` | PASS: final full run 70 files / 690 tests, 66.19 seconds |
| `npm --workspace apps/worker run typecheck` | PASS, strict TypeScript |
| `npm --workspace apps/web run build` | PASS, Next 15.5.29, 16 routes/pages |
| `npm --workspace apps/worker run dry-run:demo` | PASS, Wrangler 4.157.0, 3690.77 KiB / gzip 655.30 KiB, demo queue, SHA and preview metadata injected; dirty dry-run explicitly nondeployable |
| `npm audit --omit=dev` | FAIL (exit 1): five moderate, zero high/critical; GHSA-rmxm-3fg6-px4f in Hono node-server and dependents; no forced dependency migration attempted |
| Windows PowerShell 5.1 `-CheckOnly` | PASS with process-only execution-policy flag; target and Wrangler secret-name inventory checked, no values printed or changed |
| Deployed public readiness | BLOCKED, exit 2: six PayPal values absent; mapping required |
| Real sandbox runner | BLOCKED, exit 1 before wallet/order creation; no financial mutation |
| Sandbox OAuth | NOT RUN, credentials absent |
| Buyer approval / capture / webhook / hosted settlement / proof | NOT RUN, credentials absent |
| Hosted Cloudflare Queue | Local names isolated and dry-run verified; deployed queue lifecycle/retries NOT VERIFIED |
| Refund / reconciliation external lifecycle | NOT RUN; isolated unit/SQL tests only |

Deployed Worker SHA is **null**, frontend SHA is
`3e607b15843613ed3c59e0ed403ed4e2d2d16367`.
No commit match is established. A matching version does not establish one.

## External blockers

Absent deployed secrets: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
`PAYPAL_WEBHOOK_ID`, `PAYPAL_RETURN_BASE_URL`,
`PAYPAL_ACCOUNT_MERCHANT_ID`, `PAYPAL_MERCHANT_BINDINGS_JSON`.
Wrangler inventory and public diagnostics independently agree. The merchant
registry is absent, so neither shape nor genuine authorization can be validated.
No provider OAuth, checkout, capture or financial completion is claimed.

Operator must supply actual sandbox app credentials, register the actual callback,
obtain written merchant mapping authorization, verify isolated DB/queue/DO/Redis,
then run the interactive lifecycle and manual external failure matrix from the
[runbook](paypal-sandbox-runbook.md). The real runner automates the happy path and
capture replay only; external fault injection and refund replay remain manual.
Capture timeouts retain authority; never recapture to force completion.

The original checkout's `.git` is read-only: an explicit allowlisted stage
attempt failed creating `.git/index.lock`. A separate local review checkout at
`.validation/paypal-review` holds the review commit on the same feature branch.
Original untracked demo config and Neon initialization script are preserved and
excluded. No push, merge, deployment, secret write, migration or money-moving
operation was performed by this repair task.
