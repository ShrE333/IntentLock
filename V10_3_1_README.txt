INTENTLOCK V10.3.1 HOTFIX

Cause:
The failing test searched "headphones", but the Boat demo title did not contain that word.
The connector itself was working correctly.

Fix:
- Boat/Bose/JBL/adversarial demo titles now include "Headphones".
- The policy-classification test searches "wireless ANC headphones".
- No database changes.
- No V10.2 changes.

Apply:
1. Extract this ZIP over D:\IntentLock
2. Run:
   cd D:\IntentLock
   node .\apply-v10-3-1-hotfix.mjs
   npm test

Expected:
11 test files passed
38 tests passed

Then:
npm run dev:worker

In another PowerShell:
cd D:\IntentLock
npm run dev:web

Ensure apps\web\.env.local contains:
NEXT_PUBLIC_INTENTLOCK_API_URL=http://localhost:8787

Open:
http://localhost:3000/commerce

Search:
wireless ANC headphones

Expected:
Sony ₹5,899 => ALLOW
Sony ₹6,499 => STEP_UP
Boat ₹3,999 => BLOCK
Bose ₹7,499 => BLOCK
EvilDeals listing => merchant text marked UNTRUSTED
