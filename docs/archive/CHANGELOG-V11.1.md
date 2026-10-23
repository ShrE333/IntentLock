# IntentLock V11.1 — eBay Commerce Integration

## Live commerce discovery

- Adds an `ebay-browse` commerce connector backed by eBay's Browse API.
- Uses eBay OAuth client-credentials tokens entirely inside the Cloudflare Worker.
- Supports Sandbox and Production endpoints.
- Sends `X-EBAY-C-MARKETPLACE-ID` and optionally `X-EBAY-C-ENDUSERCTX`.
- Searches only fixed-price listings and preserves eBay's API result order.

## Authorization-safe product mapping

- Re-reads each candidate through Browse `getItem` before it becomes an IntentLock candidate.
- Maps price/currency, seller, item-location country, category, inventory and structured aspects.
- Brand and policy-facing features come from structured eBay fields/aspects, not listing prose.
- Listing description remains visible as `merchantMessage` with `UNTRUSTED` treatment.
- Adds generic source metadata (`provider`, `marketplaceId`, `listingId`) to `CommerceProduct`.

## Payment-time revalidation

- `getProduct()` performs a fresh eBay `getItem` call.
- Existing IntentLock execution-time quote revalidation therefore detects price, currency, merchant-country and structured-fact changes before a payment-sensitive transition.
- Existing FX binding, wallet policy, PayPal AUTHORIZE→CAPTURE flow, webhook verification, queue settlement, late-capture reconciliation and proof generation are unchanged.

## Token handling

- Application OAuth tokens are cached in Worker memory until shortly before expiry.
- A Browse `401` clears the cached token and retries once with a freshly minted token.
- Client secrets and OAuth tokens are never returned through connector metadata.

## Important scope boundary

V11.1 integrates eBay as a **live discovery and quote/revalidation source**. It does not call eBay Order API and does not claim that the separate PayPal checkout fulfills the eBay listing itself. A true eBay checkout integration is a later phase and requires the appropriate eBay Buy/Order API access and UX/compliance requirements.

## Tests added

The patch adds connector tests for disabled/configured registry behavior, structured-fact mapping, live price revalidation, OAuth token reuse and fail-closed malformed listing handling.
