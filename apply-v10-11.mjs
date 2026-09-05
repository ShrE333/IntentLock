import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const web=path.join(root,"apps/web");

if(!fs.existsSync(path.join(web,"package.json"))){
  throw new Error(
    "Run this from D:\\IntentLock after extracting the V10.11 ZIP over the repository."
  );
}

const packagePath=path.join(web,"package.json");
const pkg=JSON.parse(fs.readFileSync(packagePath,"utf8"));

pkg.dependencies ??= {};
pkg.dependencies["qrcode.react"]="^4.2.0";

fs.writeFileSync(
  packagePath,
  JSON.stringify(pkg,null,2)+"\n",
  "utf8"
);

const envExamplePath=path.join(web,".env.local.example");
let envExample=fs.existsSync(envExamplePath)
  ?fs.readFileSync(envExamplePath,"utf8").trimEnd()
  :"NEXT_PUBLIC_INTENTLOCK_API_URL=https://intentlock-worker.shdixit10.workers.dev";

const required=[
  ["NEXT_PUBLIC_INTENTLOCK_WHATSAPP_NUMBER","91XXXXXXXXXX"],
  ["NEXT_PUBLIC_INTENTLOCK_PAIRING_CODE","REPLACE_WITH_DEMO_PAIRING_CODE"],
  ["NEXT_PUBLIC_INTENTLOCK_DEMO_END_DATE","2026-10-05"],
];

for(const [key,value] of required){
  if(!new RegExp(`^${key}=`,`m`).test(envExample)){
    envExample+=`\n${key}=${value}`;
  }
}

fs.writeFileSync(
  envExamplePath,
  envExample+"\n",
  "utf8"
);

console.log("✓ IntentLock V10.11 minimal product UI applied");
console.log("✓ WhatsApp QR entry experience added");
console.log("✓ Demo command guide added");
console.log("✓ Architecture / tech-stack narrative added");
console.log("✓ Trust & Risk inspector added");
console.log("");
console.log("Next:");
console.log("1. npm install");
console.log("2. configure apps/web/.env.local");
console.log("3. npm --workspace apps/web run build");
console.log("4. deploy Vercel");
