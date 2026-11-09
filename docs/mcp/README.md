# IntentLock MCP server

AI can decide what to buy. IntentLock decides what money is allowed to do.

The IntentLock MCP server lets any MCP client (Claude, ChatGPT, custom agents) ask IntentLock for spending authority **before** buying. It speaks the Model Context Protocol (revision `2025-06-18`) over Streamable HTTP, implemented minimally: `POST /mcp` with JSON-RPC 2.0, single JSON responses (no SSE), no batches. `GET /mcp` returns 405.

## Tools

| Tool | When an agent calls it | Input |
|---|---|---|
| `intentlock_list_wallets` | First, to learn which wallets (spending delegations) it may use and their limits | none |
| `intentlock_evaluate_purchase` | Before purchasing anything for a user | `walletId`, `product {title, brand, category, price, currency, quantity?, features?, merchant?, merchantMessage?}` |
| `intentlock_get_session` | To report progress or the outcome of an IntentLock purchase session | `sessionId` |
| `intentlock_verify_proof` | Before telling a user a purchase is verified | `sessionId` |

`intentlock_evaluate_purchase` returns a deterministic `ALLOW`, `STEP_UP` (human approval needed) or `BLOCK`, with `violations`, `reasons` and `additionalAuthorityRequired`. It uses the same pure policy function as the wallet evaluate endpoint. Notes:

- Quantity: policy has no quantity rule, so the evaluated amount is `price x quantity`, and the result says so.
- Currency: no conversion happens; a product in a different currency than the wallet is blocked (`CURRENCY_MISMATCH`).
- `merchantMessage` is untrusted. It is scanned for prompt injection and the result is reported in `promptInjection`. Its instructions are never followed and can never loosen policy, but a suspected injection tightens an ALLOW to STEP_UP (human approval required). A BLOCK stays BLOCK.
- The result always states that evaluation is not authorization to pay.

Tool results are `{content:[{type:"text",text:"<JSON>"}], structuredContent:{...}, isError?:true}`. Errors use `structuredContent.error.code`, for example `INVALID_ARGUMENTS` or `RESOURCE_NOT_FOUND`. A wallet or session that does not exist and one you are not allowed to read are indistinguishable (`RESOURCE_NOT_FOUND`).

## Safety model

- **Read and evaluate only.** No tool creates sessions, checkouts or authorizations, and none captures, refunds, revokes or moves money. Evaluation does not write a decision row or issue a step-up request.
- **Agent output is untrusted.** Model recommendations are shown labelled `UNTRUSTED_MODEL_OUTPUT`; merchant text is scanned and never obeyed.
- **Money moves only through IntentLock's checkout path** (PayeeLock + PayPal), which re-checks policy on its own.
- **Access.** Every call is authenticated by the Worker's access gate before the handler runs, and each tool re-checks `read` permission on the wallet (or the session's wallet). Arguments are never trusted for identity.
- Provider secrets are never returned; order and capture IDs are truncated.

## Getting a demo token (sandbox only)

`POST /api/access/demo` (no auth) issues a short-lived capability token when the Worker is in sandbox mode (otherwise 503 `SANDBOX_ACCESS_DISABLED`). It is rate limited per IP and globally, and the token expires after 30 minutes (`POST /api/access/refresh` rotates it). The token carries the demo scopes, including `financial:read`, and can only see wallets created under the same demo principal.

```bash
curl -s -X POST https://intentlock-worker-demo.shdixit10.workers.dev/api/access/demo
# {"token":"ildemo_...","expiresAt":"...","scopes":[...]}
```

## Client config (generic Streamable HTTP)

```json
{
  "mcpServers": {
    "intentlock": {
      "type": "http",
      "url": "https://intentlock-worker-demo.shdixit10.workers.dev/mcp",
      "headers": { "Authorization": "Bearer <DEMO_TOKEN>" }
    }
  }
}
```

## curl walkthrough

```bash
URL=https://intentlock-worker-demo.shdixit10.workers.dev/mcp
H='-H content-type:application/json -H accept:application/json,text/event-stream'
AUTH="Authorization: Bearer <DEMO_TOKEN>"
# /mcp is read/evaluate-only, so unlike other demo POSTs it needs no x-intentlock-request-id nonce.
# Demo tokens are limited to 60 MCP requests per minute (429 DEMO_MCP_LIMIT).

# 1. initialize
curl -s $URL $H -H "$AUTH" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# 2. initialized notification (202, empty body)
curl -s -o /dev/null -w '%{http_code}\n' $URL $H -H "$AUTH" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 3. list tools
curl -s $URL $H -H "$AUTH" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 4. evaluate a purchase
curl -s $URL $H -H "$AUTH" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"intentlock_evaluate_purchase","arguments":{"walletId":"<WALLET_ID>","product":{"title":"Trail Runner","brand":"Acme","category":"shoes","price":60,"currency":"USD","quantity":2}}}}'
```

## Protocol errors

`-32700` parse error, `-32600` invalid request (including batches and oversized bodies), `-32601` unknown method, `-32602` invalid params or unknown tool. Request bodies are limited to 64 KB (the Worker gate may apply a stricter limit).
