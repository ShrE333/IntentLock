INTENTLOCK V10.3 — COMMERCE CONNECTOR LAYER

WHAT THIS ADDS
==============

- CommerceConnector interface
- DemoMarketplaceConnector
- optional real HTTP JSON catalog connector
- /api/commerce/connectors
- /api/commerce/search
- marketplace search UI
- automatic ALLOW / STEP_UP / BLOCK classification for each result
- explicit separation of untrusted merchant text from authorization facts
- Amazon Creators and IndiaMART adapter slots shown honestly as disabled until credentials/API support exist

NO FAKE AMAZON INTEGRATION
==========================

This version does NOT pretend Amazon or IndiaMART is connected.

Instead:
1. the architecture is marketplace-agnostic now;
2. the demo connector proves the flow;
3. COMMERCE_CATALOG_URL can connect any real HTTPS JSON product feed immediately;
4. Amazon/IndiaMART can later implement the same CommerceConnector interface.

OPTIONAL LIVE FEED FORMAT
=========================

Set:

COMMERCE_CATALOG_URL=https://your-api.example.com/products

The endpoint may return:

{
  "products": [
    {
      "id": "sku_1",
      "title": "Product",
      "brand": "Sony",
      "category": "electronics",
      "merchant": "Merchant",
      "price": 5899,
      "currency": "INR",
      "quantityAvailable": 10,
      "features": ["wireless","ANC"],
      "productUrl": "https://...",
      "imageUrl": "https://...",
      "merchantMessage": "merchant-controlled text"
    }
  ]
}

INSTALL
=======

1. Extract ZIP over:
   D:\IntentLock

2. Run:
   cd D:\IntentLock
   node .\apply-v10-3.mjs

3. Keep local frontend API:
   apps\web\.env.local

   NEXT_PUBLIC_INTENTLOCK_API_URL=http://localhost:8787

4. Run:
   npm test

5. Restart backend:
   npm run dev:worker

6. Restart frontend:
   npm run dev:web

7. Open:
   http://localhost:3000/commerce

EXPECTED DEMO
=============

With your Personal Electronics wallet:

Search:
wireless ANC headphones

You should see multiple merchant listings automatically evaluated.

Examples:

Sony ₹5,899
=> ALLOW

Sony ₹6,499
=> STEP_UP

Boat ₹3,999
=> BLOCK

Bose ₹7,499
=> BLOCK

EvilDeals merchant listing:
=> merchant text visibly marked UNTRUSTED
=> its message is never treated as user authorization

The next milestone V10.4 will turn this result set into a visible autonomous agent timeline:
SEARCHING → FOUND → POLICY CHECK → REJECTED / STEP_UP / SELECTED.
