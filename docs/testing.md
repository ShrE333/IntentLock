# Verification

Use Node 22 and the committed lockfile. On Windows invoke `npm.cmd` if PowerShell
blocks `npm.ps1`. Keep temporary files and npm cache in writable locations when
the system profile is restricted:

```powershell
$env:TEMP = 'D:\IntentLock\.validation\tmp'
$env:TMP = $env:TEMP
npm.cmd ci --cache D:\IntentLock\.npm-cache
npm.cmd test
npm.cmd --workspace apps/worker exec -- tsc --noEmit --strict
npm.cmd --workspace apps/web run test:browser
npm.cmd --workspace apps/web run build
npm.cmd --workspace apps/web exec -- tsc --noEmit --strict
npm.cmd audit --omit=dev
npm.cmd audit
```

Do not modify dependencies while tests or Next servers are running. Browser tests
launch their own isolated Worker fixture/PGlite and Next server. They abort external
browser origins and test both desktop Chrome and Pixel 7. This validates local
authenticated flows and UI behavior, not Cloudflare deployment or real payments.

SQL suites default to disposable PGlite with pgcrypto. For real PostgreSQL,
provision a disposable loopback PostgreSQL 17 instance with user `intentlock_test`,
password `isolated-local-test`, and admin database `postgres`. Then run:

```powershell
node apps/worker/scripts/validate-release-postgres.mjs 55448
$env:INTENTLOCK_TEST_POSTGRES_PORT = '55448'
npm.cmd test
```

The harness accepts only loopback/port configuration, creates randomly named
databases and drops only those databases. It never reads production DATABASE_URL.
The migration script checks fresh/repeated journal application, checksums and
separate-connection contention. PGlite does not establish real Neon connection
pooling or separate-connection behavior.

Bundle only, without deployment:

```powershell
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_LOG_PATH = 'D:\IntentLock\.validation\wrangler.log'
npm.cmd --workspace apps/worker exec -- wrangler deploy --dry-run --outdir .wrangler/ci-dry-run
```

The final session results and explicit blocked checks are in release-readiness.md.
The original 658/20/200 historical baseline is not a release result. No deployed
evaluation count or provider payment success is claimed by local mocks.
