# IntentLock V11.0.1 Changelog

## Global payment authorization context
- Separates wallet authority currency from merchant presentment currency.
- Adds buyer country, merchant country and seller-account capability context.
- Stores the bound context inside the selected product/session JSON so payment and proof stages reuse the same authorized facts.

## FX-bound authority
- Adds deterministic FX quote abstraction with quote ID, rate, source, timestamps and expiry.
- Same-currency transactions require no FX quote.
- Cross-currency policy is evaluated in wallet currency.
- FX identity/rate/timestamps become part of the canonical authorization hash.
- Optional FX drift revalidation before payment-sensitive transitions.

## Capability-first payment routing
- Replaces hardcoded purchase execution routing (`USD → PayPal`, `INR → Razorpay`) with per-transaction capability evaluation.
- Evaluates provider credentials, rail currency support, seller-enabled currencies and optional buyer/merchant country allowlists.
- `PAYMENT_PROVIDER_ORDER` controls auto-mode preference.
- Adds `/api/payments/capabilities` introspection endpoint.
- Adds `PAYMENT_RAIL_SELECTED` audit/session event.

## PayPal
- Keeps Orders v2 `intent=AUTHORIZE` and webhook-trusted capture invariant.
- Uses current PayPal payment currency set including zero-decimal handling for HUF, JPY and TWD.
- Keeps INR out of PayPal REST payment rail support.
- Adds explicit seller account country/currency configuration rather than assuming a PayPal account can accept every PayPal rail currency.

## Wallets / database
- Adds `country_code` to Intent Wallets (ISO alpha-2).
- Existing wallets migrate to `IN` by default.
- New wallet UI supports INR plus PayPal REST payment currencies.

## Commerce
- PayPal Sandbox Marketplace now contains USD/EUR/GBP/SGD fixtures with merchant countries.
- Marketplace numeric filtering no longer incorrectly compares merchant currency to wallet limits.
- Candidate selection sorts by normalized wallet cost.

## Settlement + proof
- Provider capture amount remains in presentment currency.
- Wallet ledger debit occurs in wallet currency using the exact bound FX context.
- Proof Receipt v1.2 records buyer/merchant country, presentment amount, wallet debit, FX quote and provider evidence.

## Tests
- Adds multi-currency normalization, FX hash-binding, provider fallback/capability, country allowlist and zero-decimal PayPal tests.
