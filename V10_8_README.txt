INTENTLOCK V10.8
================
EXTERNAL /v1/authorize API + SDK + SAFE WHATSAPP PAIRING

This milestone does two things:

1. Turns IntentLock into infrastructure other AI agents can call.
2. Stops the WhatsApp bot from replying to random inbound messages.


NEW EXTERNAL FLOW
=================

External AI Agent
      |
      v
POST /v1/authorize
      |
      v
API key authentication
      |
      v
Intent Wallet
      |
      v
Deterministic Policy
      |
      +--> BLOCK
      |
      +--> STEP_UP -> existing human approval system
      |
      +--> ALLOW -> short-lived signed INTENTLOCK_AUTH_V1 token


IMPORTANT
=========

The API does NOT move money.

It answers the narrower and safer question:

"Is this exact transaction inside delegated authority?"

Payment execution remains a separate trusted edge.


WHATSAPP SECURITY FIX
=====================

Before V10.8:
Any unknown message was interpreted as BUY.
That caused unrelated people messaging the connected WhatsApp number to receive:
"Before I can spend, I need bounded authority..."

V10.8 changes the channel to SILENT BY DEFAULT.

An unauthorized chat:
- receives no bot response
- is not stored in whatsapp_webhook_events
- cannot invoke HELP / BUY / WALLETS / approvals

To pair an approved tester, they send:

  INTENTLOCK <PAIRING_CODE>

Once paired, that chat behaves normally.

To revoke:

  INTENTLOCK STOP


INSTALL
=======

Keep WAHA stopped until the migration + Worker deploy are finished.

1. Extract this ZIP over:

   D:\IntentLock

2. Apply:

   cd D:\IntentLock
   node .\apply-v10-8.mjs

3. Neon SQL Editor:

   Run the complete file:

   D:\IntentLock\apps\worker\db\v10_8_authorize.sql

4. Tests:

   cd D:\IntentLock
   npm test

Do not deploy with failures.


NEW WORKER SECRETS
==================

Generate 3 private values locally.

PowerShell:

$AUTH_SECRET = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$ADMIN_KEY = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$PAIR_CODE = [guid]::NewGuid().ToString("N").Substring(0,16)

Keep them private.

Then:

cd D:\IntentLock\apps\worker

npx wrangler secret put INTENTLOCK_AUTH_SIGNING_SECRET
# paste $AUTH_SECRET

npx wrangler secret put INTENTLOCK_ADMIN_KEY
# paste $ADMIN_KEY

npx wrangler secret put WAHA_PAIRING_CODE
# paste $PAIR_CODE

Do NOT paste these values into Git or chat.


DEPLOY
======

npx wrangler deploy

Verify:

Invoke-RestMethod "https://intentlock-worker.shdixit10.workers.dev/health" | ConvertTo-Json

Expected:
version = v10.8

Then:

Invoke-RestMethod "https://intentlock-worker.shdixit10.workers.dev/v1/status" | ConvertTo-Json

Expected:
configured = true
decisions = ALLOW, STEP_UP, BLOCK


CREATE THE FIRST EXTERNAL API CLIENT
====================================

Use your ADMIN_KEY locally.

PowerShell:

$ADMIN_KEY = Read-Host "IntentLock admin key"

$client = Invoke-RestMethod `
  -Uri "https://intentlock-worker.shdixit10.workers.dev/v1/admin/clients" `
  -Method POST `
  -Headers @{Authorization="Bearer $ADMIN_KEY"} `
  -ContentType "application/json" `
  -Body '{"name":"IntentLock Demo Agent","scopes":["authorize","verify"]}'

$client | ConvertTo-Json -Depth 6

SAVE:
$client.apiKey

The plaintext API key is returned ONCE.
The database stores only SHA-256.


TEST /v1/authorize
==================

Set:

$API_KEY = Read-Host "IntentLock API key"
$WALLET_ID = Read-Host "Intent Wallet ID"

$body = @{
  idempotencyKey = "demo-shopify-sony-001"
  agentId = "shopping-agent-01"
  walletId = $WALLET_ID
  merchant = "Shopify"
  transaction = @{
    productName = "Sony WH-CH720N Wireless ANC Headphones"
    category = "electronics"
    brand = "Sony"
    amount = 5899
    currency = "INR"
    quantity = 1
    features = @("wireless","ANC")
  }
} | ConvertTo-Json -Depth 8

$result = Invoke-RestMethod `
  -Uri "https://intentlock-worker.shdixit10.workers.dev/v1/authorize" `
  -Method POST `
  -Headers @{Authorization="Bearer $API_KEY"} `
  -ContentType "application/json" `
  -Body $body

$result | ConvertTo-Json -Depth 10

For the normal demo wallet:
₹5899 Sony should return ALLOW + signed authorization token.


VERIFY THE TOKEN
================

$verifyBody = @{
  token = $result.authorization.token
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://intentlock-worker.shdixit10.workers.dev/v1/verify" `
  -Method POST `
  -Headers @{Authorization="Bearer $API_KEY"} `
  -ContentType "application/json" `
  -Body $verifyBody | ConvertTo-Json -Depth 10

Expected:

valid = true


IDEMPOTENCY TEST
================

Run the SAME /v1/authorize request again with:

idempotencyKey = demo-shopify-sony-001

Expected:

idempotent = true
same requestId
same authorizationId
same signed token payload

No duplicate authorization decision is created.


POLICY TESTS
============

Sony ₹5899:
ALLOW

Sony ₹6499 with auto limit ₹6000:
STEP_UP

Boat ₹3999 when blocked:
BLOCK

Bose ₹7499 with hard ceiling ₹7000:
BLOCK


QUOTE INTEGRITY
===============

The API computes the canonical SHA-256 quote itself.

An external agent may additionally provide quoteHash.

If the supplied hash differs from the transaction body:

QUOTE_HASH_MISMATCH

The agent cannot ask IntentLock to sign one transaction while presenting a hash
for another.


WHATSAPP RE-ENABLE PROCEDURE
============================

After V10.8 is deployed:

1. Start WAHA again.
2. Confirm session default = WORKING.
3. Do NOT give the pairing code publicly.
4. Send the code privately to your approved friend.
5. Friend sends:

   INTENTLOCK <PAIRING_CODE>

6. IntentLock replies once:

   IntentLock access enabled

7. Then:

   HELP
   WALLETS
   USE 1
   ...

Random people messaging the number receive NOTHING from IntentLock.


REVOKE A WHATSAPP TESTER
========================

Authorized tester sends:

INTENTLOCK STOP

The chat is immediately revoked and becomes silent again.


SDK
===

Package:

packages/sdk

Example:

import {IntentLockClient} from "@intentlock/sdk";

const client = new IntentLockClient({
  baseUrl:"https://intentlock-worker.shdixit10.workers.dev",
  apiKey:process.env.INTENTLOCK_API_KEY
});

const auth = await client.authorize({...});

The API key belongs in a trusted backend/agent runtime.
Never place it in public browser JavaScript.


WHY V10.8 MATTERS
=================

Before:
/our frontend/ -> IntentLock

After:
OpenAI agent
custom Python agent
Node agent
shopping assistant
enterprise procurement agent
etc.
        |
        v
   /v1/authorize
        |
        v
    IntentLock

This turns IntentLock from an application feature into a reusable authorization
control plane.


NEXT
====

V10.9:
Adaptive Agent Trust / Risk Score

Then production hardening:
- user/org authentication
- tenant isolation
- strict transaction state machine
- payment reconciliation
- observability/alerts
- concurrency/load/failure testing
