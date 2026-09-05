import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=r=>fs.readFileSync(path.join(root,r),"utf8");
const write=(r,v)=>fs.writeFileSync(path.join(root,r),v,"utf8");

for(const r of [
  "apps/worker/src/index.ts",
  "apps/worker/src/authorize/routes.ts",
  "apps/worker/src/whatsapp/routes.ts"
]){
  if(!fs.existsSync(path.join(root,r))){
    throw new Error(`Missing ${r}`);
  }
}

let index=read("apps/worker/src/index.ts");

const imp='import { handleAuthorizeRoutes } from "./authorize/routes";';

if(!index.includes(imp)){
  index=`${imp}\n${index}`;
}

const marker="const authorizeRouteResponse = await handleAuthorizeRoutes(request, env, url);";

if(!index.includes(marker)){
  const needle="const url = new URL(request.url);";

  if(!index.includes(needle)){
    throw new Error("Could not find Worker URL initialization.");
  }

  index=index.replace(
    needle,
`${needle}

    // V10.8 external authorization control plane.
    const authorizeRouteResponse = await handleAuthorizeRoutes(
      request,
      env,
      url
    );
    if (authorizeRouteResponse) return authorizeRouteResponse;`
  );
}

index=index.replace(
  /version:\s*["']v(?:\d+(?:\.\d+)?)["']/g,
  'version: "v10.8"'
);

write("apps/worker/src/index.ts",index);

console.log("✓ IntentLock V10.8 Authorization API + WhatsApp access gate applied");
console.log("Next: Neon migration → npm test → secrets → deploy.");
