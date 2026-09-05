# @intentlock/sdk

```ts
import {IntentLockClient} from "@intentlock/sdk";

const intentLock=new IntentLockClient({
  baseUrl:"https://intentlock-worker.shdixit10.workers.dev",
  apiKey:process.env.INTENTLOCK_API_KEY!
});

const result=await intentLock.authorize({
  idempotencyKey:"checkout-123",
  agentId:"shopping-agent-01",
  walletId:"iw_...",
  merchant:"Shopify",
  transaction:{
    productName:"Sony WH-CH720N Wireless ANC Headphones",
    category:"electronics",
    brand:"Sony",
    amount:5899,
    currency:"INR",
    quantity:1,
    features:["wireless","ANC"]
  }
});

if(result.decision==="ALLOW"){
  // Only now may the payment orchestrator proceed.
  console.log(result.authorization?.token);
}
```

IntentLock API decisions are deterministic:
- `ALLOW`
- `STEP_UP`
- `BLOCK`

The SDK never bypasses the Intent Wallet policy.
