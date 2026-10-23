# IntentLock V11.3 — Transaction Reliability + Decision Transparency

V11.3 is a reliability release. It does not add a new payment rail and it does not weaken any financial invariant. It fixes several places where a valid demo could look "hard-coded", become misleadingly BLOCKED, or remain PAYPAL_APPROVAL_PENDING because the browser never completed the external approval flow.

## Root-cause audit

### 1. Discovery and policy were coupled
The PurchaseSession runner was passing wallet `allowedCategories`, `allowedBrands`, and `requiredFeatures` into commerce discovery. This mixed two separate responsibilities:

- commerce discovery: what products match the user's request?
- financial authorization: which returned product is allowed to spend against this wallet?

V11.3 searches from the user's product intent only, then evaluates every returned candidate through deterministic wallet policy.

### 2. Candidate selection had a hard-coded "cheapest wins" rule
After connectors ranked results, the runner re-sorted all ALLOW candidates by normalized wallet amount and chose the cheapest. This could override marketplace relevance and make selection appear pre-programmed.

V11.3 preserves connector discovery order and selects the first candidate that survives policy. The selected event now records `BEST_AUTHORIZED_MATCH_IN_DISCOVERY_ORDER`.

### 3. Natural-language purchase control text polluted marketplace search
A prompt such as:

`Find me Sony wireless ANC headphones. Buy automatically if allowed.`

was sent too literally to connectors. V11.3 adds a deterministic discovery planner that removes execution/control language and common budget phrases while preserving product/model terms. The example becomes:

`Sony wireless ANC headphones`

The planner never receives wallet policy, so it cannot silently turn authorization rules into search filters.

### 4. Expired/stale wallets created misleading blocked sessions
The API previously allowed a session to be created with an expired, revoked, empty, or nearly-expired wallet and only later returned policy failures.

V11.3 performs wallet readiness before PurchaseSession creation. Invalid setup returns `WALLET_NOT_READY` and does not create another misleading BLOCKED session.

The New Purchase UI disables unusable wallets and displays the exact reason. The Wallets page now shows expiry explicitly. New wallet form default validity is 72 hours instead of 24 hours; expiry remains enforced by backend policy.

### 5. PayPal approval could remain pending because checkout was opened after awaited calls
`window.open()` occurred after asynchronous API calls. Modern browsers can treat that as a popup and block it, leaving a correctly-created PayPal order in `PAYPAL_APPROVAL_PENDING`.

V11.3 navigates to PayPal in the same tab with `window.location.assign()`. PayPal returns to the existing `/new-purchase?paypal=approved&sessionId=...` flow, which then authorizes, revalidates, and requests capture.

Existing pending sessions gain explicit recovery controls:

- `PAYPAL_APPROVAL_PENDING` → Resume PayPal Approval
- `AUTHORIZED` → Resume Safe Capture
- `CAPTURE_PENDING` → Refresh / inspect in Transaction Control

No browser action can mark a transaction CAPTURED.

### 6. V11.1 live connector environment could be dropped before session execution
The session route reconstructed a smaller orchestration environment. Optional eBay and PayeeLock configuration could be omitted from the object passed to the PurchaseSession runner.

V11.3 preserves the complete commerce + authorization environment. This matters when eBay credentials become available.

### 7. Pending states were not explained
Trust Center now reports a specific pending reason and next action, e.g. buyer approval required, capture request not finished, or verified webhook pending. `PENDING` is no longer presented as one generic failure state.

## Decision engine remains deterministic
The wallet evaluator is still independent of the LLM. V11.3 adds clearer reasons for every major violation, including hard ceiling, remaining authority, category, brand, feature, expiry and revocation.

The new regression tests explicitly run the same transaction through different wallet data and verify that it can become ALLOW, STEP_UP, or BLOCK based on policy inputs.

## New tests

- commerce discovery planner: 4 tests
- dynamic policy outcomes / wallet readiness: 5 tests
- orchestration environment preservation: 1 test

Expected delta: +10 tests over the current local suite.

## No database migration

V11.3 changes application logic and UI only. Existing PayPal settlement, V11.0.2/V11.0.3 recovery SQL, proof receipts, queues, PayeeLock, TrustOps, Razorpay and eBay adapter files remain compatible.
