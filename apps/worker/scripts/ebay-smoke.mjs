// Run from apps/worker with Node 22+:
// node --env-file=.dev.vars scripts/ebay-smoke.mjs "Sony wireless ANC headphones"
// This script never prints the client secret or OAuth token.

const required=name=>{
  const value=String(process.env[name]??"").trim();
  if(!value) throw new Error(`${name} is not configured`);
  return value;
};

const env=String(process.env.EBAY_ENV??"sandbox").trim().toLowerCase()==="production"?"production":"sandbox";
const base=env==="production"?"https://api.ebay.com":"https://api.sandbox.ebay.com";
const marketplace=String(process.env.EBAY_MARKETPLACE_ID??"EBAY_US").trim().toUpperCase();
const query=process.argv.slice(2).join(" ").trim()||"Sony wireless ANC headphones";

try{
  const clientId=required("EBAY_CLIENT_ID");
  const clientSecret=required("EBAY_CLIENT_SECRET");
  const basic=Buffer.from(`${clientId}:${clientSecret}`,"utf8").toString("base64");
  const tokenResponse=await fetch(`${base}/identity/v1/oauth2/token`,{
    method:"POST",
    headers:{authorization:`Basic ${basic}`,"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      grant_type:"client_credentials",
      scope:"https://api.ebay.com/oauth/api_scope"
    }),
    signal:AbortSignal.timeout(30000)
  });
  const tokenPayload=await tokenResponse.json().catch(()=>({}));
  if(!tokenResponse.ok||!tokenPayload.access_token) throw new Error(`eBay OAuth failed with HTTP ${tokenResponse.status}`);

  const params=new URLSearchParams({
    q:query,limit:"3",fieldgroups:"EXTENDED",filter:"buyingOptions:{FIXED_PRICE}"
  });
  const searchResponse=await fetch(`${base}/buy/browse/v1/item_summary/search?${params}`,{
    headers:{authorization:`Bearer ${tokenPayload.access_token}`,"x-ebay-c-marketplace-id":marketplace,accept:"application/json"},
    signal:AbortSignal.timeout(30000)
  });
  const searchPayload=await searchResponse.json().catch(()=>({}));
  if(!searchResponse.ok) throw new Error(`eBay Browse search failed with HTTP ${searchResponse.status}`);

  const rows=(Array.isArray(searchPayload.itemSummaries)?searchPayload.itemSummaries:[]).slice(0,3).map(item=>({
    itemId:item.itemId,
    title:item.title,
    price:item.price?.value,
    currency:item.price?.currency,
    seller:item.seller?.username,
    country:item.itemLocation?.country,
    url:item.itemWebUrl
  }));

  console.log(JSON.stringify({ok:true,environment:env,marketplace,query,count:rows.length,items:rows},null,2));
}catch(error){
  const message=error instanceof Error?error.message:String(error);
  console.error(message.replace(/https?:\/\/[^\s]*:[^@\s]*@/g,"[redacted-url]"));
  process.exitCode=1;
}
