# IntentLock API contract

- `openapi.json` - OpenAPI 3.1 description of the integrator-facing API (sandbox demo and API-client surface).
- `intentlock.postman_collection.json` - Postman Collection v2.1 with the happy path in order.

## Safety notes

- The hosted demo is **PayPal Sandbox only**. No real funds are involved.
- Money moves only through **PayPal checkout approved by the buyer** plus a **verified PayPal webhook**. No endpoint in this contract moves funds directly.
- Demo tokens (`POST /api/access/demo`) are sandbox capabilities that expire after 30 minutes and are rate limited.
- Operator-only routes (`x-intentlock-ops-token`) are intentionally out of scope and not documented. Refund request and sync routes are operator-only.
- Discovery-only connectors (`shopify-global-catalog`, `channel3-catalog`) return `discoveryOnly: true` and `executionAllowed: false`; they can be searched but never used to create a session or payment.
- Never commit tokens. The collection stores the token in a collection variable at run time.

## Authentication

1. `POST /api/access/demo` returns `{token, expiresAt, scopes}`. Send it as `Authorization: Bearer <token>`.
2. Every demo `POST` mutation (except `/api/access/*`) needs a unique `x-intentlock-request-id` header matching `^[-a-zA-Z0-9_]{16,128}$` (a UUID works). Missing or malformed gives `400 REQUEST_ID_REQUIRED`; reuse gives `409 REQUEST_REPLAYED`.
3. `404 RESOURCE_NOT_FOUND` is returned both for missing resources and for resources the caller has no permission on, so existence is never revealed.
4. `/v1/*` endpoints use an API client key (Bearer) with the `authorize` or `verify` scope.

## Import into Postman

1. Postman > Import > select `docs/api/intentlock.postman_collection.json` (optionally also `openapi.json` to get a generated collection).
2. Collection variables: `baseUrl` (defaults to the sandbox demo), `token`, `walletId`, `sessionId`, `validUntil` (the last four are filled by scripts).
3. Run requests 1 to 6 in order (or use the Collection Runner). A collection pre-request script sets a fresh `x-intentlock-request-id` on every POST.
4. Request 6 (refund evaluation) is expected to return `400 SESSION_PAYMENT_NOT_FOUND` until the session has a captured sandbox payment, which requires a real PayPal Sandbox buyer approval.

## Generate an SDK or developer portal with APIMatic

Generic steps (not yet performed for this repository):

1. Sign in to your APIMatic account and create an API entity by importing `openapi.json` (file upload or hosted URL).
2. Review the validation report, then use the SDK generation feature to pick languages and download or publish the packages.
3. Use the portal generation feature with the same definition to build a developer portal, adding your own guides and branding.
4. Re-import `openapi.json` whenever the API changes.

## Contract test

`apps/worker/src/tests/openapi-contract.test.ts` checks that the spec is valid structurally, that every `$ref` resolves, that every documented non-operator route is recognised by the worker, and that the Postman collection contains no token-like strings.
