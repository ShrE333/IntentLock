# Upgrade to IntentLock V11.4.1

Base commit expected: `c0260bf39786378e5c6a8fcd0805025423a626db` (V11.4 checkpoint).

## 1. Extract

Extract this ZIP into the repository root:

```text
D:\IntentLock
```

Choose **Replace files in destination**.

## 2. Apply the small in-place stabilization edits

The ZIP intentionally does not replace the very large `apps/worker/src/index.ts`. Run:

```powershell
cd D:\IntentLock
node .\apply-v11-4-1.mjs
```

The script:

- adds `x-intentlock-ops-token` to both global CORS header sites;
- updates visible/backend version strings to V11.4.1;
- removes the accidental `lkdvm` file;
- verifies the extracted refund-reliability files are present.

It is idempotent and refuses to patch an unexpected Git base unless `--force` is supplied.

## 3. No SQL migration

Do **not** create another database migration for V11.4.1. The existing V11.4 migration remains the required database level:

```text
apps/worker/db/v11_4_post_purchase_guard.sql
```

## 4. Verify

```powershell
npm test
npm --workspace apps/web run build
cd apps\worker
npx.cmd wrangler deploy --dry-run --outdir .wrangler\v11-4-1-dry-run
```

V11.4.1 adds 7 regression tests to the previously validated 208-test baseline, so a fully merged tree is expected to report 215 tests if no other tests have been added locally.

## 5. Inspect before commit

```powershell
cd D:\IntentLock
git status --short
git diff --stat
git diff -- apps/worker/src/index.ts apps/worker/src/post-purchase/service.ts apps/worker/src/post-purchase/policy.ts
```

Also confirm secrets remain ignored:

```powershell
git check-ignore apps/worker/.dev.vars
```

## 6. Do not refund the clean demo transaction

Use a fresh PayPal sandbox purchase for actual refund execution. The existing clean successful capture remains useful as an end-to-end proof artifact.
