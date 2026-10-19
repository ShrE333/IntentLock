import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,writeFileSync,unlinkSync} from "node:fs";
import {resolve} from "node:path";

const EXPECTED_HEAD="c0260bf39786378e5c6a8fcd0805025423a626db";
const root=process.cwd();
const force=process.argv.includes("--force");

function fail(message){
  console.error(`V11.4.1 apply failed: ${message}`);
  process.exit(1);
}
function git(...args){
  return execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
}
function read(rel){
  const path=resolve(root,rel);
  if(!existsSync(path)) fail(`missing ${rel}`);
  return readFileSync(path,"utf8");
}
function write(rel,value){
  writeFileSync(resolve(root,rel),value,"utf8");
}
function replaceExact(rel,from,to,{expected=1}={}){
  let value=read(rel);
  if(value.includes(to) && !value.includes(from)){
    console.log(`already patched: ${rel}`);
    return;
  }
  const count=value.split(from).length-1;
  if(count!==expected) fail(`${rel}: expected ${expected} occurrence(s), found ${count}`);
  value=value.split(from).join(to);
  write(rel,value);
  console.log(`patched: ${rel}`);
}

if(!existsSync(resolve(root,"package.json"))||!existsSync(resolve(root,"apps/worker/src/index.ts")))
  fail("run this script from the IntentLock repository root");

let head="";
try{ head=git("rev-parse","HEAD"); }
catch{ fail("could not read git HEAD"); }
if(head!==EXPECTED_HEAD&&!force){
  fail(`expected base ${EXPECTED_HEAD.slice(0,7)}, found ${head.slice(0,7)}. Re-run with --force only after reviewing the diff.`);
}

// Global OPTIONS runs before route-specific CORS, so the privileged browser
// header must be allowed here as well as inside Trust Center.
replaceExact(
  "apps/worker/src/index.ts",
  '"access-control-allow-headers": "content-type,x-razorpay-signature"',
  '"access-control-allow-headers": "content-type,x-razorpay-signature,x-intentlock-ops-token"',
  {expected:2}
);

replaceExact(
  "apps/worker/src/trust-center/routes.ts",
  'version:"v11.4",',
  'version:"v11.4.1",'
);

replaceExact(
  "apps/web/app/components/Shell.tsx",
  'V11.4 · Post-purchase guard',
  'V11.4.1 · Reliability hardening'
);
replaceExact(
  "apps/web/app/components/Shell.tsx",
  '>V11.4</span>',
  '>V11.4.1</span>'
);
replaceExact(
  "apps/web/app/post-purchase/page.tsx",
  'INTENTLOCK V11.4 · POST-PURCHASE GUARD',
  'INTENTLOCK V11.4.1 · POST-PURCHASE GUARD'
);

const accidental=resolve(root,"lkdvm");
if(existsSync(accidental)){
  unlinkSync(accidental);
  console.log("deleted accidental file: lkdvm");
}else{
  console.log("already absent: lkdvm");
}

for(const [rel,marker] of [
  ["apps/worker/src/post-purchase/service.ts","REFUND_PROVIDER_STATE_UNCERTAIN"],
  ["apps/worker/src/post-purchase/policy.ts","alreadyReservedWalletCreditAmount"],
  ["apps/worker/src/tests/refund-reliability.test.ts","V11.4.1 refund reliability"],
  ["apps/worker/src/tests/trustops-cors.test.ts","TrustOps browser preflight"],
  [".github/workflows/ci.yml","IntentLock CI"]
]){
  if(!read(rel).includes(marker)) fail(`extracted file verification failed: ${rel}`);
}

console.log("\nIntentLock V11.4.1 applied successfully.");
console.log("Next:");
console.log("  npm test");
console.log("  npm --workspace apps/web run build");
console.log("  cd apps/worker");
console.log("  npx.cmd wrangler deploy --dry-run --outdir .wrangler\\v11-4-1-dry-run");
