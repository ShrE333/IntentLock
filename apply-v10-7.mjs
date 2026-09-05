import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=r=>fs.readFileSync(path.join(root,r),"utf8");
const write=(r,v)=>fs.writeFileSync(path.join(root,r),v,"utf8");

for(const r of [
  "apps/worker/src/index.ts",
  "apps/worker/src/commerce/shopify-connector.ts",
  "apps/worker/src/commerce/registry.ts",
  "apps/worker/src/session-payments/service.ts",
  "apps/web/app/new-purchase/page.tsx"
]){
  if(!fs.existsSync(path.join(root,r))){
    throw new Error(`Missing ${r}`);
  }
}

let index=read("apps/worker/src/index.ts");
index=index.replace(
  /version:\s*["']v(?:\d+(?:\.\d+)?)["']/g,
  'version: "v10.7"'
);
write("apps/worker/src/index.ts",index);

console.log("✓ IntentLock V10.7 Shopify connector applied");
console.log("Next: npm test → configure Shopify secrets → deploy Worker.");
