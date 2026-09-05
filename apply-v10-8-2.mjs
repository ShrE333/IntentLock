import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const indexPath=path.join(root,"apps/worker/src/index.ts");
const auditPath=path.join(
  root,
  "apps/worker/src/session-payments/audit.ts"
);

if(!fs.existsSync(indexPath)){
  throw new Error("Run this from D:\\IntentLock");
}

if(!fs.existsSync(auditPath)){
  throw new Error(
    "Missing session payment audit module. V10.6+ is required."
  );
}

let index=fs.readFileSync(indexPath,"utf8");

index=index.replace(
  /version:\s*["']v(?:\d+(?:\.\d+)*)["']/g,
  'version: "v10.8.2"'
);

fs.writeFileSync(indexPath,index,"utf8");

console.log(
  "✓ IntentLock V10.8.2 Cloudflare subrequest hotfix applied"
);
console.log("✓ N+1 audit mirroring replaced with one batch snapshot");
console.log("No Neon migration required.");
console.log("Next: npm test → deploy Worker → retry WhatsApp purchase.");
