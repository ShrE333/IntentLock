const base=process.env.INTENTLOCK_BASE_URL||"http://localhost:8787";
const sessionId=process.argv[2];
if(!sessionId){console.error("usage: node scripts/post-purchase-smoke.mjs ps_...");process.exit(2);}
const state=await fetch(`${base}/api/trust-center/post-purchase/${encodeURIComponent(sessionId)}`).then(async r=>({status:r.status,body:await r.json()}));
console.log(JSON.stringify(state,null,2));
if(state.status!==200) process.exit(1);
