import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=r=>fs.readFileSync(path.join(root,r),"utf8");
const write=(r,v)=>fs.writeFileSync(path.join(root,r),v,"utf8");

for(const r of [
  "apps/worker/src/index.ts",
  "apps/worker/src/whatsapp/routes.ts"
]){
  if(!fs.existsSync(path.join(root,r))) throw new Error(`Missing ${r}`);
}

let index=read("apps/worker/src/index.ts");

const imp='import { handleWhatsappRoutes } from "./whatsapp/routes";';
if(!index.includes(imp)) index=`${imp}\n${index}`;

const marker="const whatsappRouteResponse = await handleWhatsappRoutes(request, env, url);";

if(!index.includes(marker)){
  const sessionMarker=`const sessionRouteResponse = await handleSessionRoutes(request, env, url);
    if (sessionRouteResponse) return sessionRouteResponse;`;

  if(index.includes(sessionMarker)){
    index=index.replace(
      sessionMarker,
      `${sessionMarker}

    const whatsappRouteResponse = await handleWhatsappRoutes(request, env, url);
    if (whatsappRouteResponse) return whatsappRouteResponse;`
    );
  } else {
    const needle="const url = new URL(request.url);";
    if(!index.includes(needle)) throw new Error("Could not find Worker URL initialization.");

    index=index.replace(
      needle,
      `${needle}

    const whatsappRouteResponse = await handleWhatsappRoutes(request, env, url);
    if (whatsappRouteResponse) return whatsappRouteResponse;`
    );
  }
}

index=index.replace(
  /version:\s*["']v(?:\d+(?:\.\d+)?)["']/g,
  'version: "v10.5"'
);

write("apps/worker/src/index.ts",index);

console.log("✓ IntentLock V10.5 WhatsApp bridge applied");
console.log("Next: Neon migration → npm test → configure Worker secrets → deploy.");
