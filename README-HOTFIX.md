# V11.4.1.1 — TrustOps Vitest CORS hotfix

Fixes Node/Vitest loader error `Received protocol cloudflare:` in `trustops-cors.test.ts`.

## Apply

Extract the ZIP into `D:\IntentLock` and replace files. From PowerShell:

```powershell
cd D:\IntentLock
node .\apply-v11-4-1-1-cors-hotfix.mjs
npm test
npm --workspace apps/web run build
cd apps\worker
npx.cmd wrangler deploy --dry-run --outdir .wrangler\v11-4-1-1-dry-run
```

This hotfix requires V11.4.1 to have already been extracted and `apply-v11-4-1.mjs` to have been run. It makes one minimal Worker wiring change and replaces one test; there are no schema or configuration changes. The two `content-type`/TrustOps CORS uses remain covered by a single exported constant. The global OPTIONS behavior is covered by a pure unit test and the Worker deployment dry-run verifies the integration compiles.

**Note:** Do not commit secrets or send the TrustOps token to a browser except your own trusted operator interface. The authentication token is a high-privilege credential; the CORS header merely allows the browser to send it, not permission to bypass authentication.
