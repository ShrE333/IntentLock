# Release gate — 2026-11-05

**Verdict: locally verified sandbox candidate; NOT production ready.**
The full requested roadmap is not complete. No production deploy, DB mutation,
live-money request, external sandbox checkout or provider credential verification
was performed. The feature inventory distinguishes source from operational proof.

## Source and Git

- Branch: `feat/intentlock-full-completion` (not main).
- Base HEAD: `2c298c67f243663f91bc8bb345878ccf460ccad4`.
- Remote main returned the same SHA using read-only `git ls-remote`.
- Fetch fails writing `.git/FETCH_HEAD`; staging fails creating `.git/index.lock`.
  The workspace exposes `.git` as read-only. **No new commit exists.**
- Existing untracked `apps/worker/wrangler.demo.jsonc` and
  `intentlock-neon-empty-db-init.mjs` were preserved, not executed or included.
- Proposed commit: `fix: harden sandbox readiness and refresh release dependencies`.
  A review patch and explicit commit helper are prepared under ignored `.validation`.
  Apply/stage only the listed release files in a Git-writable checkout. Do not
  stage all untracked files or commit local environment/cache/database artifacts.

## Final verification results

| Check | Actual result |
|---|---|
| `npm.cmd ci --cache D:\IntentLock\.npm-cache --no-fund` | PASS, final lockfile install; 269 packages added |
| `npm.cmd test` | PASS, 68 files / 672 tests; Vitest 4.1.12, 80.49 seconds |
| Worker strict TypeScript | PASS |
| Frontend strict TypeScript | PASS, repeated after production build |
| Next production build | PASS, Next 15.5.29, all 16 generated pages/routes in build output |
| Playwright desktop + Pixel 7 | PASS, 20/20, process exit 0; manual cleanup of this run's server child processes was needed for Windows teardown (6.6 minutes total) |
| Main route runtime errors and viewport fit | PASS in both browser projects, including proof error state |
| Authenticated API/payment replay/security/SQL tests | PASS within 672-test suite, using isolated provider mocks and disposable SQL |
| Full 19-migration fresh initialization | PASS with disposable PGlite; does not prove Neon upgrade compatibility |
| Separate-connection PostgreSQL migration/contention script | BLOCKED, `ECONNREFUSED 127.0.0.1:55448`; no local server available |
| Wrangler dry-run | PASS, Wrangler 4.157.0; 3690.48 KiB / gzip 654.95 KiB; no deployment |
| `npm audit --omit=dev` | 4 moderate, 0 high, 0 critical; audit exit 1 |
| `npm audit` | 4 moderate, 0 high, 0 critical; audit exit 1 |
| Diff whitespace | PASS |
| Deployed 200-scenario evaluations | NOT RUN; historical count not reused |
| Actual PayPal/Razorpay/WAHA/Neon/queue integration | BLOCKED pending isolated external configuration and execution |

The first test attempt hit system temp ENOSPC after 540 passes. The workspace-temp
retry passed. An early browser run was invalidated by a concurrent dependency
update; it is excluded from final results. The final browser run used the finished
dependency tree. Playwright's Windows process-tree cleanup stalled after all test
cases passed; only this run's known server processes were stopped manually. CI on
Linux still needs to run against the resulting commit.

## Fixed in this change

- Misleading PayPal readiness booleans: structured missing-setting names and
  validation issues now reach both API diagnostics and demo UI, without secrets.
- Missing merchant mapping setup in `.dev.vars.example`; explicit setup documented.
- Unsafe/malformed PayPal return origins rejected before order creation.
- Stale Worker version metadata; explicit SHA/environment now available for release
  correlation (operator must set it; null is not a match).
- INR-before-amount, one-week and category/approval-threshold grammar now supported;
  omitted permissions still require clarification and confirmation.
- Initial 21 dependency findings reduced to 4 moderate, with no force upgrade;
  high/critical CI audit gates added. Overrides and residual risk documented.
- Full migration initialization and new compiler/configuration regression coverage;
  stale README/compiler status corrected and six release documents added.

## Open release blockers and reproduction

1. **Provider setup and E2E:** read preview `/api/payments/provider`; inspect
   `paypalReadiness.missing/issues`. Follow deployment.md for the eight required
   values plus explicit sandbox environment and merchant approval. Execute a real
   isolated sandbox buyer approval and verified webhook/queue settlement; verify
   debit, receipt, duplicate/reordered events and refunds. Do not use live money.
2. **Dependency advisory:** run either audit command above. Hono node-server 1.19.18
   remains affected by GHSA-rmxm-3fg6-px4f, propagating to MCP/Agents/ai-chat. Review
   and validate an adapter v2 migration before calling the dependency tree clean.
3. **Real DB migration/upgrade/contention:** provision disposable loopback PG17;
   run `node apps/worker/scripts/validate-release-postgres.mjs 55448`, then opt SQL
   suites into that port as documented. Validate Neon schema/role/connection behavior
   on an isolated branch. Never point this work at a production database.
4. **Deployment separation/SHA:** configure separate preview resources and exact
   CORS origins; compare Worker health SHA with Vercel build-info. No deployed
   endpoints or Git-SHA correlation were externally verified here.
5. **Git/CI:** run the explicit commit helper in a Git-writable checkout; inspect
   staged diff, commit on this feature branch, and run GitHub CI. No automatic merge
   or production deployment is part of this gate.
6. **Product gaps:** general wallet editing/revocation flow, real merchant checkout,
   Razorpay full commerce slice, fulfillment tracking, enterprise identity, passkeys,
   organization budgets and recurring mandates remain partial or missing. Amazon
   and IndiaMART registry labels are not integrations. See feature-status.md.

Rollback and operator setup are in deployment.md. Preserve all financial records,
pending reservations and provider evidence during application rollback.
