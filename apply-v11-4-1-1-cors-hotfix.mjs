import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";

const root=process.cwd();
const path=resolve(root,"apps/worker/src/index.ts");
const helperPath=resolve(root,"apps/worker/src/http/cors.ts");
const testPath=resolve(root,"apps/worker/src/tests/trustops-cors.test.ts");

function fail(message){console.error("V11.4.1.1 hotfix: "+message);process.exit(1);}
if(!existsSync(path)||!existsSync(helperPath)||!existsSync(testPath))
  fail("Extract the ZIP over D:\\IntentLock, then run from the repository root.");
const helper=readFileSync(helperPath,"utf8");
const test=readFileSync(testPath,"utf8");
if(!helper.includes("globalPreflightResponse")||!test.includes('from "../http/cors"'))
  fail("Missing or incorrect hotfix files.");
let content=readFileSync(path,"utf8");
const importLine='import {CORS_ALLOWED_HEADERS,globalPreflightResponse} from "./http/cors";\n';
const importValue=importLine.replace("\\n","\n");
if(!content.includes(importValue)) content=importValue+content;

const old='"access-control-allow-headers": "content-type,x-razorpay-signature,x-intentlock-ops-token"';
const oldCount=content.split(old).length-1;
if(oldCount===2){
  content=content.split(old).join('"access-control-allow-headers": CORS_ALLOWED_HEADERS');
}else if(!content.includes('"access-control-allow-headers": CORS_ALLOWED_HEADERS')){
  fail(`Expected 2 existing CORS headers from V11.4.1, found ${oldCount}. Run the original V11.4.1 apply script first.`);
}
const begin='    if (request.method === "OPTIONS") {';
const end='\n\n    const url = new URL(request.url);';
if(content.includes(begin)){
  const start=content.indexOf(begin);
  const stop=content.indexOf(end,start);
  if(stop<0) fail("Cannot locate the end of global OPTIONS handler.");
  const section=content.slice(start,stop);
  if(!section.includes('"access-control-allow-origin"')||!section.includes('"access-control-allow-methods"'))
    fail("Unexpected global OPTIONS handler; no changes were written.");
  content=content.slice(0,start)+
    '    if (request.method === "OPTIONS") return globalPreflightResponse();'+
    content.slice(stop);
}else if(!content.includes('if (request.method === "OPTIONS") return globalPreflightResponse();')){
  fail("Unexpected global OPTIONS handler; no changes were written.");
}
if(!content.includes(importValue)||!content.includes('return globalPreflightResponse();'))
  fail("CORS handler was not wired correctly.");
writeFileSync(path,content,"utf8");
console.log("V11.4.1.1 CORS hotfix applied. Global OPTIONS now calls a dependency-free, testable handler.");
console.log("Run npm test, npm --workspace apps/web run build, then wrangler deploy --dry-run.");
