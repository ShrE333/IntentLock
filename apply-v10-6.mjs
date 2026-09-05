import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=r=>fs.readFileSync(path.join(root,r),"utf8");
const write=(r,v)=>fs.writeFileSync(path.join(root,r),v,"utf8");

for(const r of [
  "apps/worker/src/index.ts",
  "apps/worker/src/session-payments/routes.ts",
  "apps/web/app/globals.css",
  "apps/web/app/new-purchase/page.tsx"
]){
  if(!fs.existsSync(path.join(root,r))){
    throw new Error(`Missing ${r}`);
  }
}

let index=read("apps/worker/src/index.ts");

const imp='import { handleSessionPaymentRoutes } from "./session-payments/routes";';

if(!index.includes(imp)){
  index=`${imp}\n${index}`;
}

const marker="const sessionPaymentRouteResponse = await handleSessionPaymentRoutes(request.clone(), env, url);";

if(!index.includes(marker)){
  const needle="const url = new URL(request.url);";

  if(!index.includes(needle)){
    throw new Error("Could not find Worker URL initialization.");
  }

  index=index.replace(
    needle,
`${needle}

    // V10.6 must run before the legacy V7 Razorpay webhook.
    // It handles PurchaseSession-linked payments and returns null for legacy payments.
    const sessionPaymentRouteResponse = await handleSessionPaymentRoutes(
      request.clone(),
      env,
      url
    );
    if (sessionPaymentRouteResponse) return sessionPaymentRouteResponse;`
  );
}

index=index.replace(
  /version:\s*["']v(?:\d+(?:\.\d+)?)["']/g,
  'version: "v10.6"'
);

write("apps/worker/src/index.ts",index);

let css=read("apps/web/app/globals.css");

if(!css.includes("INTENTLOCK V10.6 — PAYMENT + PROOF")){
  css=`${css.trim()}\n\n${read("V10_6_CSS.txt").trim()}\n`;
  write("apps/web/app/globals.css",css);
}

console.log("✓ IntentLock V10.6 Payment + Proof applied");
console.log("Next: Neon migration → npm test → deploy Worker → test Razorpay.");
