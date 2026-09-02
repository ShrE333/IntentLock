# V6 — Distributed Checkout Idempotency

The same approved checkout must never create multiple provider payment attempts
because an agent, browser or network retries the request.

## Key

The idempotency key is SHA-256 over:

- fixed `checkout` namespace
- Intent ID
- product ID
- quantity
- currency
- exact quote hash

The final Redis key is:

`intentlock:checkout:<sha256>`

## Claim

Upstash receives:

SET key value NX EX 900

Only the first request can acquire the key.

All retries receive the existing claim instead of permission to create another
payment.

## Defense in depth

V6 adds Redis as the fast distributed duplicate gate.

Neon already has:

`transactions.idempotency_key UNIQUE`

so the final database also rejects duplicate transaction records.

## Demo

POST /api/security/duplicate-checkout-demo

with `attempts: 10`.

Expected:

- attempts requested: 10
- payment attempts: 1
- duplicates rejected: 9
- duplicate money movement: ₹0
- result: PASS
