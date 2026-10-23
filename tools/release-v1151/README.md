# IntentLock V11.5.1 — Safe release verification kit

This is an **additive kit**, not a rewrite of V11.5. It is designed for a repo with newer local work than the pushed GitHub branches. It does not enable WAHA, mutate payment state, deploy services, apply migrations, or rewrite environment variables.

## Install on Windows

1. Extract the ZIP outside `D:\IntentLock`, e.g. `D:\Downloads\IntentLock-V11.5.1-Release-Verification`.
2. Run:

```powershell
cd D:\Downloads\IntentLock-V11.5.1-Release-Verification
.\tools\release-v1151\APPLY.ps1 -RepositoryPath 'D:\IntentLock'
```

`APPLY.ps1` refuses to overwrite existing files and does not delete anything.

## Local source checks

```powershell
cd D:\IntentLock
node .\tools\release-v1151\audit.mjs
```

The source auditor lists missing V11.4.3–V11.5 reports/migrations and Git/staging hygiene, but does **not** claim those checks prove runtime behavior.

## Run the backend and frontend validation (no payments)

```powershell
.\tools\release-v1151\run-validation.ps1 -WithBrowser
```

You can add `-WithPostgres` only after setting up an **isolated local test Postgres**, never production Neon. Default PostgreSQL port is 5432. Run the CI-equivalent PostgreSQL integration checks from your existing test scripts separately as your repo report describes.

## Compare deployed website with local Git SHA

```powershell
node .\tools\release-v1151\audit.mjs --web https://intentlock-web.vercel.app --api https://intentlock-worker.shdixit10.workers.dev
```

The app needs to include `/api/build-info` in a **newly built Vercel deployment**; an old deployment will return 404 on that path. When the app was deployed through Vercel Git integration, its `gitCommit` should match the *intended deployed commit* (it will not match local HEAD if you intentionally deploy a previous candidate).

You can use `https://intentlock-web.vercel.app/api/build-info` in a browser once deployed. If the endpoint has a null Git SHA, inspect Vercel's Deployment details and its Git-linked production branch; do not treat a null SHA as a match.

## WAHA

WAHA is intentionally **optional/off** for these checks. Do not remove its integration or interpret its downtime as evidence that the core Worker or frontend failed.

## Deployment caution

- Vercel's `Production Branch` often defaults to `main`; pushing a feature branch usually creates a Preview deployment, not a production deployment.
- The repository's Next.js app is located in `apps/web`. Verify Vercel project `Settings > Build and Deployment > Root Directory` and correct environment variables.
- `NEXT_PUBLIC_INTENTLOCK_API_URL` must point to the correct HTTPS Cloudflare Worker URL at **build time**. It is intentionally not written into the package.
- V11.4.4–V11.5 migrations, grant rollout and PayPal recipient/provider gates must be reviewed before enabling financial execution.
- A fresh frontend release talking to an old Worker can fail even if its build succeeds. Verify frontend/Worker compatibility on Preview before promoting.
- Never paste secrets or full `.dev.vars` into chat or CI logs.
