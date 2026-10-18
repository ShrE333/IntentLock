# IntentLock V11.0 Change Log

## Payment architecture

- Introduced `PaymentProviderName` and normalized checkout/payment evidence.
- Added PayPal Orders v2 `AUTHORIZE` order creation.
- Added PayPal order authorization and Payments v2 authorization capture.
- Added PayPal webhook verification before any trusted settlement transition.
- Added provider-aware payment idempotency.
- Added conservative handling for ambiguous provider network outcomes: once a money-moving provider call starts, one-time authority is not automatically released.
- Protected against a fast-webhook race that could otherwise downgrade `CAPTURED` back to `CAPTURE_PENDING`.
- Kept Razorpay compatibility.

## Commerce

- Added `PayPalDemoMarketplaceConnector` with a deterministic USD catalog.
- Kept the original INR demo connector.
- Kept Shopify optional rather than making it a core dependency.
- Added prompt-injection/adversarial listing fixture to the PayPal catalog.

## Data model

- Added generic provider order, authorization and capture identifiers.
- Expanded PurchaseSession states for PayPal approval/authorization/capture.
- Relaxed payment/ledger currency constraints from INR-only to ISO 3-letter currencies.
- Added provider identity to webhook evidence and wallet-spend evidence.
- Added a provider-aware replay-safe wallet-spend database function.

## UI

- Intent Wallets can now be created in USD or INR.
- Marketplace and autonomous-purchase pages render the product's real currency.
- Autonomous Purchase exposes PayPal's intermediate states instead of collapsing checkout into payment.
- Proof Receipt now renders provider-neutral order/authorization/capture evidence.

## Still intentionally deferred

These belong to later V11 phases, not this first patch:

- MCP server wrapping `/v1/authorize`.
- Natural-language policy compiler + human-confirmed diff.
- Full live Red-Team Arena.
- Ed25519 portable proof receipts (current V11.0 receipt remains HMAC-signed).
- Refund/payout policy agent.
- Multi-agent delegated sub-wallets.
