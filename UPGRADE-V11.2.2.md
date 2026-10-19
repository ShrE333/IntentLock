# Upgrade to V11.2.2

Base: V11.2.1 Unified UI on top of V11.2 TrustOps.

1. Extract this ZIP into `D:\IntentLock` and replace files in destination.
2. No database migration is required.
3. No secrets or provider configuration change is required.
4. Restart the Next.js frontend.

```powershell
cd D:\IntentLock
npm run dev:web
```

Keep the Worker running as usual:

```powershell
cd D:\IntentLock
npm run dev:worker
```

Open:

```text
http://localhost:3000
http://localhost:3000/trust-center
```

For the best end-to-end view, use:

```text
http://localhost:3000/trust-center?sessionId=ps_...
```

If no session ID is supplied, Trust Center selects the latest captured session when available.

Expected behavior for the old recovered PayPal transaction:
- payment / ledger / proof stages should show completed if the existing APIs report them;
- PayeeLock may show `LEGACY` because that session was created before PayeeLock was introduced. This is intentional and truthful.
