import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=r=>fs.readFileSync(path.join(root,r),"utf8");
const write=(r,v)=>fs.writeFileSync(path.join(root,r),v,"utf8");

for(const r of [
  "apps/worker/src/index.ts",
  "apps/web/app/globals.css",
  "apps/worker/src/wallets/routes.ts",
  "apps/worker/src/wallets/stepup.ts",
  "apps/web/app/wallets/page.tsx"
]){
  if(!fs.existsSync(path.join(root,r))) throw new Error(`Missing ${r}`);
}

let index=read("apps/worker/src/index.ts");
index=index.replace(/version:\s*["']v(?:\d+(?:\.\d+)?)["']/g,'version: "v10.2"');
write("apps/worker/src/index.ts",index);

let css=read("apps/web/app/globals.css");
if(!css.includes("INTENTLOCK V10.2 — STEP-UP CONSENT")){
  css=`${css.trim()}\n\n${read("V10_2_CSS.txt").trim()}\n`;
  write("apps/web/app/globals.css",css);
}

console.log("✓ IntentLock V10.2 applied");
console.log("Run the Neon v10_2 migration, npm test, then restart worker + web.");
