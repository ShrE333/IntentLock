INTENTLOCK V10.8.3 — SIGNED TOKEN CANONICALIZATION
==================================================

WHY THE TEST FAILED
===================

The failed test changed the final Base64URL character of an HMAC signature.

For an unpadded Base64URL string, the final character can contain unused low
padding bits. In some cases two different final characters decode to the exact
same byte sequence.

So:

different token text
        ↓
same decoded signature bytes
        ↓
HMAC comparison succeeds

This is Base64 encoding malleability, not an HMAC break.

Because IntentLock stores SHA-256 hashes of authorization tokens, accepting
multiple textual encodings of the same signed bytes is undesirable.


FIX
===

Both token verifiers now require canonical unpadded Base64URL.

Verifier behavior:

decode
  ↓
re-encode
  ↓
must exactly equal original segment
  ↓
then verify HMAC

This gives one textual representation per signed token.


FILES
=====

apps/worker/src/wallets/crypto.ts
apps/worker/src/authorize/crypto.ts
apps/worker/src/tests/token-canonicalization.test.ts

No Neon migration required.


APPLY
=====

Extract over D:\IntentLock.

Then:

cd D:\IntentLock
node .\apply-v10-8-3.mjs
npm test

Expected:

all test files passed
all tests passed

Then:

cd D:\IntentLock\apps\worker
npx wrangler deploy

Verify:

Invoke-RestMethod "https://intentlock-worker.shdixit10.workers.dev/health" | ConvertTo-Json

Expected:
version = v10.8.3
