INTENTLOCK V10.2 — CRYPTOGRAPHIC STEP-UP APPROVAL

Adds:
- STEP_UP request persistence
- exact-quote SHA-256 binding
- 10-minute human-consent window
- Allow Once
- Raise Auto Limit
- Reject
- HMAC-SHA256 one-time authorization token
- token hash persisted in Neon
- cryptographic tests

IMPORTANT LOCAL FRONTEND FIX

For local testing apps/web/.env.local must use:

NEXT_PUBLIC_INTENTLOCK_API_URL=http://localhost:8787

Restart Next.js after changing it.

INSTALL

1. Extract over:
   D:\IntentLock

2. Run:
   cd D:\IntentLock
   node .\apply-v10-2.mjs

3. Neon SQL Editor:
   run apps/worker/db/v10_2_step_up.sql

4. Ensure apps/worker/.dev.vars already contains APPROVAL_SIGNING_SECRET.
   Do not paste/share this secret.

5. Run:
   npm test

6. Restart:
   npm run dev:worker

7. In another terminal:
   npm run dev:web

8. Open:
   http://localhost:3000/wallets

TEST

Choose/create wallet:
Auto limit 6000
Hard ceiling 7000

Evaluate Sony ₹6499.

Expected:
STEP_UP
+₹499

Buttons:
- Reject
- Raise Auto Limit
- Allow Once ₹6,499

ALLOW ONCE:
Creates a signed authorization bound to the exact quote and a 10-minute expiry.

RAISE AUTO LIMIT:
Changes persistent auto_buy_limit from ₹6000 to ₹6499.

REJECT:
Payment remains disallowed.

Do not deploy until local tests and UI pass.
