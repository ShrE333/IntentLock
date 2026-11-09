// Operator live check: one Channel3 search. Reads CHANNEL3_API_KEY from the local env; never prints it.
// npm script runs with --dns-result-order=ipv4first: some networks (DNS64/NAT64) return synthetic IPv6 addresses whose route stalls in Node.
const key=process.env.CHANNEL3_API_KEY?.trim();
if(!key){console.log(JSON.stringify({error:'CHANNEL3_API_KEY_MISSING'}));process.exit(2);}
// Generous ceiling: this measures reachability and latency, not production timeouts.
const started=Date.now(),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),45000);
const elapsedMs=()=>Date.now()-started;
try{
  const res=await fetch('https://api.trychannel3.com/v1/search',{method:'POST',redirect:'manual',signal:abort.signal,
    headers:{'x-api-key':key,'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({query:'wireless noise cancelling headphones',limit:3,config:{country:'US',currency:'USD'}})});
  if(!res.ok){console.log(JSON.stringify({status:res.status,elapsedMs:elapsedMs(),error:res.status===429?'CHANNEL3_RATE_LIMITED':res.status===401||res.status===403?'CHANNEL3_AUTH_REJECTED':'CHANNEL3_UNAVAILABLE'}));process.exit(1);}
  const body=await res.json();const products=Array.isArray(body?.products)?body.products:null;
  if(!products){console.log(JSON.stringify({status:res.status,error:'CHANNEL3_RESPONSE_INVALID'}));process.exit(1);}
  console.log(JSON.stringify({status:res.status,elapsedMs:elapsedMs(),productCount:products.length,sample:products.slice(0,3).map(p=>{const o=p?.offers?.[0];return {title:p?.title,brand:p?.brands?.[0]?.name??null,domain:o?.domain??null,price:o?.price?.price??null,currency:o?.price?.currency??null};})},null,2));
}catch(e){console.log(JSON.stringify({elapsedMs:elapsedMs(),error:abort.signal.aborted?'CHANNEL3_TIMEOUT':'CHANNEL3_UNAVAILABLE',...(abort.signal.aborted?{}:{cause:String(e?.cause?.code??e?.name??'').slice(0,40)})}));process.exit(1);}
finally{clearTimeout(timer);}
