import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=r=>fs.readFileSync(path.join(root,r),"utf8");
const write=(r,v)=>fs.writeFileSync(path.join(root,r),v,"utf8");

for(const r of [
  "apps/worker/src/index.ts",
  "apps/web/app/components/Shell.tsx",
  "apps/web/app/globals.css",
  "apps/worker/src/sessions/routes.ts",
  "apps/web/app/new-purchase/page.tsx"
]){
  if(!fs.existsSync(path.join(root,r))) throw new Error(`Missing ${r}`);
}

let index=read("apps/worker/src/index.ts");
const imp='import { handleSessionRoutes } from "./sessions/routes";';
if(!index.includes(imp)) index=`${imp}\n${index}`;

const marker="const sessionRouteResponse = await handleSessionRoutes(request, env, url);";
if(!index.includes(marker)){
  const commerceMarker=`const commerceRouteResponse = await handleCommerceRoutes(request, env, url);
    if (commerceRouteResponse) return commerceRouteResponse;`;

  if(index.includes(commerceMarker)){
    index=index.replace(commerceMarker,`${commerceMarker}

    const sessionRouteResponse = await handleSessionRoutes(request, env, url);
    if (sessionRouteResponse) return sessionRouteResponse;`);
  }else{
    const needle="const url = new URL(request.url);";
    if(!index.includes(needle)) throw new Error("Could not find worker URL initialization.");
    index=index.replace(needle,`${needle}

    const sessionRouteResponse = await handleSessionRoutes(request, env, url);
    if (sessionRouteResponse) return sessionRouteResponse;`);
  }
}

index=index.replace(/version:\s*["']v(?:\d+(?:\.\d+)?)["']/g,'version: "v10.4"');
write("apps/worker/src/index.ts",index);

let shell=read("apps/web/app/components/Shell.tsx");
shell=shell.replace(
  '{ href: "/new-purchase", label: "New Purchase", icon: "✦" },',
  '{ href: "/new-purchase", label: "Autonomous Purchase", icon: "✦" },'
);
write("apps/web/app/components/Shell.tsx",shell);

let css=read("apps/web/app/globals.css");
if(!css.includes("INTENTLOCK V10.4 — UNIFIED PURCHASE SESSION")){
  css=`${css.trim()}\n\n${read("V10_4_CSS.txt").trim()}\n`;
}

// Clean the V10.3 autoprefixer warning.
css=css.replace(/align-items:end/g,"align-items:flex-end");
write("apps/web/app/globals.css",css);

console.log("✓ IntentLock V10.4 applied");
console.log("Run Neon v10_4 migration, npm test, then restart worker + web.");
