import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=r=>fs.readFileSync(path.join(root,r),"utf8");
const write=(r,v)=>fs.writeFileSync(path.join(root,r),v,"utf8");

for(const r of [
  "apps/worker/src/index.ts",
  "apps/web/app/components/Shell.tsx",
  "apps/web/app/globals.css",
  "apps/worker/src/wallets/routes.ts",
  "apps/web/app/wallets/page.tsx"
]){
  if(!fs.existsSync(path.join(root,r))) throw new Error(`Missing ${r}`);
}

let index=read("apps/worker/src/index.ts");
const imp='import { handleWalletRoutes } from "./wallets/routes";';
if(!index.includes(imp)) index=`${imp}\n${index}`;

const marker="const walletRouteResponse = await handleWalletRoutes(request, env, url);";
if(!index.includes(marker)){
  const needle="const url = new URL(request.url);";
  if(!index.includes(needle)) throw new Error('Could not find const url = new URL(request.url);');
  index=index.replace(needle,`${needle}

    const walletRouteResponse = await handleWalletRoutes(request, env, url);
    if (walletRouteResponse) return walletRouteResponse;`);
}
index=index.replace(/version:\s*["']v(?:\d+(?:\.\d+)?)["']/g,'version: "v10.1"');
write("apps/worker/src/index.ts",index);

let shell=read("apps/web/app/components/Shell.tsx");
if(!shell.includes('href: "/wallets"')){
  const needle='{ href: "/new-purchase", label: "New Purchase", icon: "✦" },';
  if(!shell.includes(needle)) throw new Error("Could not find New Purchase nav item.");
  shell=shell.replace(needle,`${needle}
  { href: "/wallets", label: "Intent Wallets", icon: "◈" },`);
  write("apps/web/app/components/Shell.tsx",shell);
}

let css=read("apps/web/app/globals.css");
if(!css.includes("INTENTLOCK V10.1 — INTENT WALLETS")){
  css=`${css.trim()}\n\n${read("V10_1_CSS.txt").trim()}\n`;
  write("apps/web/app/globals.css",css);
}

console.log("✓ IntentLock V10.1 applied");
console.log("Next: run Neon migration, npm test, then start worker + web.");
