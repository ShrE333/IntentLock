import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=r=>fs.readFileSync(path.join(root,r),"utf8");
const write=(r,v)=>fs.writeFileSync(path.join(root,r),v,"utf8");

for(const r of [
  "apps/worker/src/index.ts",
  "apps/web/app/components/Shell.tsx",
  "apps/web/app/globals.css",
  "apps/worker/src/commerce/routes.ts",
  "apps/web/app/commerce/page.tsx"
]){
  if(!fs.existsSync(path.join(root,r))) throw new Error(`Missing ${r}`);
}

let index=read("apps/worker/src/index.ts");

const imp='import { handleCommerceRoutes } from "./commerce/routes";';
if(!index.includes(imp)) index=`${imp}\n${index}`;

const marker="const commerceRouteResponse = await handleCommerceRoutes(request, env, url);";
if(!index.includes(marker)){
  const walletMarker=`const walletRouteResponse = await handleWalletRoutes(request, env, url);
    if (walletRouteResponse) return walletRouteResponse;`;

  if(index.includes(walletMarker)){
    index=index.replace(walletMarker,`${walletMarker}

    const commerceRouteResponse = await handleCommerceRoutes(request, env, url);
    if (commerceRouteResponse) return commerceRouteResponse;`);
  }else{
    const needle="const url = new URL(request.url);";
    if(!index.includes(needle)) throw new Error("Could not find worker URL initialization.");
    index=index.replace(needle,`${needle}

    const commerceRouteResponse = await handleCommerceRoutes(request, env, url);
    if (commerceRouteResponse) return commerceRouteResponse;`);
  }
}

index=index.replace(/version:\s*["']v(?:\d+(?:\.\d+)?)["']/g,'version: "v10.3"');
write("apps/worker/src/index.ts",index);

let shell=read("apps/web/app/components/Shell.tsx");
if(!shell.includes('href: "/commerce"')){
  const needle='{ href: "/wallets", label: "Intent Wallets", icon: "◈" },';
  if(!shell.includes(needle)) throw new Error("Could not find Intent Wallets nav item.");
  shell=shell.replace(needle,`${needle}
  { href: "/commerce", label: "Marketplace", icon: "⌕" },`);
  write("apps/web/app/components/Shell.tsx",shell);
}

let css=read("apps/web/app/globals.css");
if(!css.includes("INTENTLOCK V10.3 — COMMERCE CONNECTORS")){
  css=`${css.trim()}\n\n${read("V10_3_CSS.txt").trim()}\n`;
  write("apps/web/app/globals.css",css);
}

console.log("✓ IntentLock V10.3 applied");
console.log("Run npm test, restart worker + web, then open /commerce.");
