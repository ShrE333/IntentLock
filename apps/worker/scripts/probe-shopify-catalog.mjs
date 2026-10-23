// Explicit read-only probe. The Shopify-hosted example profile is for this probe
// only; deployments must configure their own reviewed agent profile.
const endpoint='https://catalog.shopify.com/api/ucp/mcp';
const profile='https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json';
async function read(tool,catalog){
 if(!['search_catalog','lookup_catalog','get_product'].includes(tool))throw new Error('READ_ONLY_TOOL_REQUIRED');
 const payload={jsonrpc:'2.0',id:tool,method:'tools/call',params:{name:tool,arguments:{meta:{'ucp-agent':{profile}},catalog}}};
 const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 const body=await response.json();const data=body.result?.structuredContent;
 if(!response.ok||body.error||body.result?.isError||!data)throw new Error('CATALOG_PROBE_FAILED:'+tool);
 const p=data.product??data.products?.[0],v=p?.variants?.[0];
 console.log(JSON.stringify({tool,status:response.status,version:data.ucp?.version,productId:p?.id,variantId:v?.id,price:v?.price,sellerId:v?.seller?.id,available:v?.availability?.available}));return v?.id;
}
const context={address_country:'US',currency:'USD'},filters={ships_to:{country:'US'},available:false};
const id=await read('search_catalog',{query:'wireless headphones',context,filters,pagination:{limit:1}});
if(id){await read('lookup_catalog',{ids:[id],context,filters});await read('get_product',{id,context,filters});}
const shop=await fetch('https://mcp.shop.com',{method:'POST',redirect:'error',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','Mcp-Method':'tools/list','MCP-Protocol-Version':'2026-07-28'},body:JSON.stringify({jsonrpc:'2.0',id:'shop-tools',method:'tools/list',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}}),signal:AbortSignal.timeout(15000)});
const listing=await shop.json();console.log(JSON.stringify({shopMcpStatus:shop.status,tools:listing.result?.tools?.map(t=>t.name),error:listing.error?.code}));
