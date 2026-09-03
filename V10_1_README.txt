INTENTLOCK V10.1 — INTENT WALLET + AUTONOMY MANDATES

This milestone adds:
- Intent Wallet persistence in Neon
- Delegated spending authority
- ALLOW / STEP_UP / BLOCK decisions
- Wallet decision logs
- /api/wallets
- /api/wallets/:id/evaluate
- /wallets frontend
- 7 wallet-policy tests

Intent Wallet stores AUTHORITY, not money.
Razorpay remains the payment rail.

INSTALL

1. Extract this ZIP directly over:
   D:\IntentLock

2. Run:
   cd D:\IntentLock
   node .\apply-v10-1.mjs

3. In Neon SQL Editor run:
   D:\IntentLock\apps\worker\db\v10_1_intent_wallets.sql

4. Run tests:
   npm test

5. Start backend:
   npm run dev:worker

6. In another PowerShell:
   cd D:\IntentLock
   npm run dev:web

7. Open:
   http://localhost:3000/wallets

DEMO VALUES

Wallet:
  Total authority       ₹10,000
  Auto-buy limit        ₹6,000
  Max single purchase   ₹7,000
  Allowed brands        Sony, Bose
  Blocked brand         Boat
  Required              wireless, ANC
  Validity              24h

Expected:
  Sony ₹5,899  => ALLOW
  Sony ₹6,499  => STEP_UP (+₹499)
  Boat ₹3,999  => BLOCK (BRAND_BLOCKED)

DEPLOY ONLY AFTER LOCAL TEST PASSES

Backend:
  cd D:\IntentLock\apps\worker
  npx wrangler deploy

Frontend:
  git add .
  git commit -m "feat: add Intent Wallets and autonomy mandates"
  git push origin main
