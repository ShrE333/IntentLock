# V4 — Exact-Quote Approval

IntentLock approval is bound to the exact transaction the user saw.

The signed approval payload contains:

- intent ID
- product ID
- quantity
- total amount
- currency
- exact quote hash
- issued time
- expiry time
- random nonce

The quote hash is SHA-256 over a canonical cart snapshot.

The approval token is HMAC-SHA256 signed.

## Security invariant

If any transaction-affecting field changes after approval:

- product
- quantity
- price
- currency
- relevant features
- intent

the recomputed quote hash will differ and checkout returns:

`QUOTE_CHANGED`

Money moved must remain `0`.

## Local secret

Create `apps/worker/.dev.vars`:

`APPROVAL_SIGNING_SECRET=<strong-random-secret>`

Never commit `.dev.vars`.
