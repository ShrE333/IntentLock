import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const indexPath=path.join(root,"apps/worker/src/index.ts");

if(!fs.existsSync(indexPath)){
  throw new Error("Run this from D:\\IntentLock");
}

let index=fs.readFileSync(indexPath,"utf8");

index=index.replace(
  /version:\s*["']v(?:\d+(?:\.\d+)?)["']/g,
  'version: "v10.8.1"'
);

fs.writeFileSync(indexPath,index,"utf8");

console.log("✓ IntentLock V10.8.1 WhatsApp hotfix applied");
console.log("No Neon migration required.");
console.log("Next: npm test → deploy Worker → pair one tester.");
