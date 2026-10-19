const base=(process.argv[2]||"http://localhost:8787").replace(/\/+$/g,"");
const paths=["/api/trust-center/overview","/api/trust-center/reconciliation"];
for(const path of paths){
  const response=await fetch(base+path,{headers:{accept:"application/json"}});
  const body=await response.text();
  if(!response.ok){
    console.error(`${path} -> HTTP ${response.status}`);
    process.exitCode=1;
    continue;
  }
  const parsed=JSON.parse(body);
  console.log(`${path} -> OK`);
  if(path.endsWith("overview")){
    console.log(JSON.stringify({version:parsed.version,features:parsed.features,reconciliation:parsed.reconciliation,payeeLock:parsed.payeeLock},null,2));
  }else{
    console.log(JSON.stringify({counts:parsed.counts,findings:Array.isArray(parsed.findings)?parsed.findings.length:0},null,2));
  }
}
