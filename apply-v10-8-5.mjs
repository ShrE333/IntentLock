import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const indexPath=path.join(
  root,
  "apps/worker/src/index.ts"
);

if(!fs.existsSync(indexPath)){
  throw new Error(
    "Run this from D:\\IntentLock"
  );
}

let index=fs.readFileSync(
  indexPath,
  "utf8"
);

const importLine=
  'import { handlePurchaseQueue } from "./queue/purchase-jobs";';

if(!index.includes(importLine)){
  index=`${importLine}\n${index}`;
}

if(!/\basync\s+queue\s*\(/.test(index)){
  const exportObject=
    /export\s+default\s*\{\s*/;

  if(!exportObject.test(index)){
    throw new Error(
      "Could not locate `export default {` in Worker index.ts."
    );
  }

  index=index.replace(
    exportObject,
`export default {
  async queue(batch:any, env:any, ctx:any) {
    return handlePurchaseQueue(batch,env,ctx);
  },

  `
  );
}

index=index.replace(
  /version:\s*["']v(?:\d+(?:\.\d+)*)["']/g,
  'version: "v10.8.5"'
);

fs.writeFileSync(
  indexPath,
  index,
  "utf8"
);

console.log(
  "✓ IntentLock V10.8.5 async purchase pipeline applied"
);
console.log(
  "✓ WhatsApp webhook no longer runs Shopify + Razorpay inline"
);
console.log(
  "✓ PurchaseSession candidate events are batched"
);
console.log(
  "✓ updateSession now uses one DB request"
);
console.log(
  "Next: configure the Cloudflare Queue → npm test → deploy."
);
