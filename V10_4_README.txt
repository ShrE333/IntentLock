INTENTLOCK V10.4 — UNIFIED PURCHASESESSION + VISIBLE AGENT ACTIVITY

THIS IS THE PIPELINE-GLUE MILESTONE.

What changes:
- New Purchase becomes Autonomous Purchase.
- Every task now gets one sessionId.
- A wallet is mandatory.
- Commerce search runs inside the PurchaseSession.
- Every candidate is evaluated by the same wallet policy.
- Merchant-controlled text is logged as UNTRUSTED.
- A deterministic candidate is selected.
- ALLOW ends at READY_TO_PAY.
- STEP_UP is resolved inside the same PurchaseSession.
- All steps are persisted as purchase_session_events.
- The V10.3 CSS autoprefixer warning is cleaned up.

IMPORTANT:
READY_TO_PAY deliberately does not yet claim Razorpay execution.
The final payment edge is wired when we build the payment + Proof Receipt milestone.

INSTALL

1. Extract over:
   D:\IntentLock

2. Run:
   cd D:\IntentLock
   node .\apply-v10-4.mjs

3. Neon SQL Editor:
   Run all of:
   D:\IntentLock\apps\worker\db\v10_4_purchase_sessions.sql

4. Run:
   npm test

Expected approximately:
   40 tests passing
   (exact count may vary only if you added your own tests)

5. Ensure:
   apps\web\.env.local
   NEXT_PUBLIC_INTENTLOCK_API_URL=http://localhost:8787

6. Start backend:
   npm run dev:worker

7. Check:
   Invoke-RestMethod http://localhost:8787/health | ConvertTo-Json

Expected:
   version = v10.4

8. Start frontend in a second PowerShell:
   cd D:\IntentLock
   npm run dev:web

9. Open:
   http://localhost:3000/new-purchase

DEMO

Select:
Personal Electronics

Prompt:
Find Sony or Bose wireless ANC headphones under ₹7,000. Buy automatically if allowed.

Start Autonomous Purchase.

Expected:
SESSION_CREATED
WALLET_ATTACHED
USER_INTENT_RECEIVED
SEARCH_STARTED
PRODUCT_FOUND
MERCHANT_TEXT_OBSERVED
POLICY_DECISION
...
CANDIDATE_SELECTED
AUTO_AUTHORIZED

The selected candidate should normally be:
Sony ₹5,899
=> READY_TO_PAY

To exercise step-up through the unified session, use a wallet where the auto-buy
limit is below the best valid candidate or use a connector/result set with no
autonomously ALLOW candidate.

ROADMAP AFTER THIS:
#1 Intent Wallet             DONE
#2 Step-Up                   DONE
#3 Commerce Connector        DONE
#4 PurchaseSession/Activity  THIS MILESTONE
#5 WhatsApp / WAHA           NEXT
#6 Payment wiring + Proof Receipt
#7 /v1/authorize API/SDK
#8 Adaptive Trust Score
