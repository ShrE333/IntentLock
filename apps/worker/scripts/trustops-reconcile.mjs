const base=(process.env.INTENTLOCK_WORKER_URL||process.argv[2]||"").replace(/\/+$/g,"");
const sessionId=process.argv[3]||"";
const token=process.env.TRUSTOPS_ADMIN_TOKEN||"";
if(!base||!sessionId||!token){
  console.error("Usage: TRUSTOPS_ADMIN_TOKEN=... node scripts/trustops-reconcile.mjs <worker-base-url> <session-id>");
  process.exit(2);
}
const response=await fetch(`${base}/api/trust-center/reconciliation/${encodeURIComponent(sessionId)}/reconcile`,{
  method:"POST",headers:{"x-intentlock-ops-token":token,"content-type":"application/json"},body:"{}"
});
const body=await response.text();
if(!response.ok){console.error(`HTTP ${response.status}: ${body}`);process.exit(1);}
console.log(body);
