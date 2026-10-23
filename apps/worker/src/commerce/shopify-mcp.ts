import {z} from 'zod';
import type {CommerceConnector,CommerceProduct,CommerceSearchQuery} from './types';
import {validCurrency,validMoney} from '../wallets/validation';

export const SHOPIFY_CATALOG_ENDPOINT='https://catalog.shopify.com/api/ucp/mcp';
export const CATALOG_VERSION='2026-08-25';
export const CATALOG_TOOLS=['search_catalog','lookup_catalog','get_product'] as const;
export type CatalogTool=typeof CATALOG_TOOLS[number];
export type ShopifyMcpEnv={SHOPIFY_GLOBAL_CATALOG_ENABLED?:string;SHOPIFY_CATALOG_AGENT_PROFILE_URL?:string};
const short=z.string().trim().min(1).max(300);
const variantId=z.string().regex(/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/);
const productId=z.string().regex(/^gid:\/\/shopify\/(?:p\/[A-Za-z0-9_-]+|Product\/[1-9]\d*)$/);
const catalogId=z.union([variantId,productId]);
const country=z.string().regex(/^[A-Z]{2}$/);
const context=z.object({address_country:country,currency:z.string().refine(validCurrency)}).strict();
const schemas={
 search_catalog:z.object({query:z.string().trim().min(1).max(400),context,pagination:z.object({limit:z.number().int().min(1).max(10)}).strict(),filters:z.object({ships_to:z.object({country}).strict(),available:z.literal(false)}).strict()}).strict(),
 lookup_catalog:z.object({ids:z.array(catalogId).min(1).max(10),context,filters:z.object({ships_to:z.object({country}).strict(),available:z.literal(false)}).strict()}).strict(),
 get_product:z.object({id:catalogId,context,filters:z.object({ships_to:z.object({country}).strict(),available:z.literal(false)}).strict()}).strict()
};
export class CatalogError extends Error{
 constructor(public code:string,public status=502){super(code);}
}
function publicHttps(value:string){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.')&&!/^(?:localhost|.*\.localhost|.*\.local|\d[\d.]*|\[.*\])$/i.test(u.hostname)?u:null;}catch{return null;}
}
function profileUrl(env:ShopifyMcpEnv){
 const raw=env.SHOPIFY_CATALOG_AGENT_PROFILE_URL;
 const url=raw?publicHttps(raw):null;
 if(!url||url.search||url.hash)throw new CatalogError('SHOPIFY_AGENT_PROFILE_REQUIRED',503);
 return url.href;
}
export function shopifyMcpEnabled(env:ShopifyMcpEnv){return env.SHOPIFY_GLOBAL_CATALOG_ENABLED==='true';}
export function shopifyMcpConfigured(env:ShopifyMcpEnv){try{return shopifyMcpEnabled(env)&&Boolean(profileUrl(env));}catch{return false;}}

async function boundedText(response:Response){
 if(!response.body)throw new CatalogError('MCP_EMPTY_RESPONSE');
 const reader=response.body.getReader();const decoder=new TextDecoder();let size=0,text='';
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>1048576){await reader.cancel();throw new CatalogError('MCP_RESPONSE_TOO_LARGE');}text+=decoder.decode(value,{stream:true});
 }return text+decoder.decode();}finally{reader.releaseLock();}
}
export class ShopifyCatalogClient{
 constructor(private readonly env:ShopifyMcpEnv,private readonly fetcher:typeof fetch=globalThis.fetch.bind(globalThis),private readonly timeoutMs=8000){}
 async call(tool:CatalogTool,args:unknown):Promise<unknown>{
  if(!shopifyMcpEnabled(this.env))throw new CatalogError('SHOPIFY_CATALOG_DISABLED',503);
  if(!(CATALOG_TOOLS as readonly string[]).includes(tool))throw new CatalogError('MCP_TOOL_NOT_ALLOWED',400);
  const parsed=schemas[tool].safeParse(args);if(!parsed.success)throw new CatalogError('MCP_ARGUMENTS_INVALID',400);
  const profile=profileUrl(this.env),id=crypto.randomUUID();const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),this.timeoutMs);
  try{
   const response=await this.fetcher(SHOPIFY_CATALOG_ENDPOINT,{method:'POST',redirect:'error',signal:abort.signal,
    headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},
    body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:tool,arguments:{meta:{'ucp-agent':{profile}},catalog:parsed.data}}})});
   if(response.status===429)throw new CatalogError('SHOPIFY_CATALOG_RATE_LIMITED',429);
   if(!response.ok)throw new CatalogError('SHOPIFY_CATALOG_UNAVAILABLE',502);
   const type=response.headers.get('content-type')??'';
   if(!/application\/json|text\/event-stream/i.test(type))throw new CatalogError('MCP_CONTENT_TYPE_INVALID');
   const text=await boundedText(response);let raw:unknown;
   try{
    if(type.includes('text/event-stream')){
     const messages=text.replaceAll('\r\n','\n').split('\n\n').flatMap(block=>{
      const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
      return data?[JSON.parse(data)]:[];
     }).filter(m=>m.id===id);
     if(messages.length!==1)throw 0;raw=messages[0];
    }else raw=JSON.parse(text);
   }catch{throw new CatalogError('MCP_RESPONSE_INVALID');}
   const rpc=z.object({jsonrpc:z.literal('2.0'),id:z.literal(id),error:z.unknown().optional(),result:z.object({isError:z.boolean().optional(),structuredContent:z.unknown()}).optional()}).safeParse(raw);
   if(!rpc.success||rpc.data.error!==undefined||!rpc.data.result||rpc.data.result.isError)throw new CatalogError('MCP_TOOL_RESPONSE_INVALID');
   return rpc.data.result.structuredContent;
  }catch(error){if(error instanceof CatalogError)throw error;throw new CatalogError(abort.signal.aborted?'SHOPIFY_CATALOG_TIMEOUT':'SHOPIFY_CATALOG_UNAVAILABLE',abort.signal.aborted?504:502);}
  finally{clearTimeout(timer);}
 }
}

const money=z.object({amount:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),currency:z.string().refine(validCurrency)});
const description=z.object({plain:z.string().max(16000).optional(),html:z.string().max(16000).optional()}).optional();
const variant=z.object({id:variantId,title:short.optional(),price:money,availability:z.object({available:z.boolean()}),
 seller:z.object({id:z.string().regex(/^gid:\/\/shopify\/Shop\/[1-9]\d*$/),name:short,domain:short,url:short}),
 url:z.string().max(2000).optional(),description,condition:z.array(z.string().max(100)).max(10).optional(),
 requires:z.object({shipping:z.boolean().optional()}).optional()});
const product=z.object({id:productId,title:short,description,variants:z.array(variant).min(1).max(50),options:z.array(z.unknown()).max(30).optional(),
 metadata:z.object({attributes:z.array(z.unknown()).max(30).optional(),unique_selling_points:z.array(z.string().max(500)).max(30).optional(),top_features:z.array(z.string().max(500)).max(30).optional(),tech_specs:z.array(z.string().max(500)).max(30).optional()}).optional()});
const envelope=z.object({ucp:z.object({version:z.literal(CATALOG_VERSION),status:z.literal('success').optional(),capabilities:z.record(z.string(),z.array(z.object({version:z.string()})))}),products:z.array(product).max(50).optional(),product:product.optional()});
export function minorDigits(currency:string){
 if(!validCurrency(currency))throw new CatalogError('MCP_CURRENCY_INVALID');
 return ['JPY','KRW','VND','CLP','XAF','XOF','XPF','BIF','DJF','GNF','KMF','PYG','RWF','UGX','VUV','ISK'].includes(currency)?0:['BHD','IQD','JOD','KWD','LYD','OMR','TND'].includes(currency)?3:2;
}
export function normalizeCatalog(raw:unknown,tool:CatalogTool,shippingCountry:string,ids:string[]=[]):CommerceProduct[]{
 const parsed=envelope.safeParse(raw);if(!parsed.success)throw new CatalogError('UCP_CATALOG_FACTS_INVALID');
 const body=parsed.data;const capability=tool==='search_catalog'?'dev.ucp.shopping.catalog.search':'dev.ucp.shopping.catalog.lookup';
 if(![capability,'dev.shopify.catalog.global'].every(key=>body.ucp.capabilities[key]?.some(c=>c.version===CATALOG_VERSION)))throw new CatalogError('UCP_CAPABILITY_MISMATCH');
 const products=tool==='get_product'?(body.product?[body.product]:null):body.products;
 if(!products)throw new CatalogError('UCP_CATALOG_FACTS_INVALID');
 const results:CommerceProduct[]=[];const seen=new Set<string>();
 for(const p of products)for(const v of p.variants){
  if(ids.length&&!ids.includes(v.id)&&!ids.includes(p.id))throw new CatalogError('MCP_IDENTITY_MISMATCH');
  if(seen.has(v.id))throw new CatalogError('MCP_DUPLICATE_VARIANT');seen.add(v.id);
  const sellerUrl=publicHttps(v.seller.url),domain=publicHttps('https://'+v.seller.domain);
  if(!sellerUrl||!domain||domain.hostname!==v.seller.domain||domain.pathname!=='/')throw new CatalogError('MCP_MERCHANT_IDENTITY_INVALID');
  const digits=minorDigits(v.price.currency),price=v.price.amount/10**digits;
  if(!validMoney(price,v.price.currency)||Math.round(price*10**digits)!==v.price.amount)throw new CatalogError('MCP_PRICE_PRECISION_INVALID');
  const url=v.url?publicHttps(v.url):null;
  const productUrl=url&&url.origin===sellerUrl.origin&&/^\/products\/[^/]+\/?$/.test(url.pathname)?url.origin+url.pathname+'?variant='+v.id.split('/').at(-1):undefined;
  const text=[p.description?.plain,p.description?.html,v.description?.plain,v.description?.html].filter(Boolean).join('\n').slice(0,16000);
  // ZZ explicitly means unknown origin; never inherit a deployment-wide demo
  // merchant-country fallback for a different merchant in the global catalog.
  results.push({id:v.id,title:p.title,brand:'',category:'',merchant:v.seller.name,merchantCountry:'ZZ',price,currency:v.price.currency,
   quantityAvailable:v.availability.available?1:0,features:[],productUrl,merchantMessage:text||undefined,
   source:{provider:'shopify-global-catalog',listingId:p.id,marketplaceId:v.seller.domain,payeeId:v.seller.id,payeeType:'SHOPIFY_STORE'},
   discovery:{only:true,endpoint:SHOPIFY_CATALOG_ENDPOINT,productId:p.id,variantId:v.id,sellerId:v.seller.id,sellerDomain:v.seller.domain,sellerUrl:sellerUrl.href,
    minorAmount:v.price.amount,minorDigits:digits,available:v.availability.available,requestedShippingCountry:shippingCountry,shippingVerified:false,
    ...(v.requires?.shipping!==undefined?{requiresShipping:v.requires.shipping}:{}),condition:v.condition??[],conditionTrust:'INFERRED',
    inferredFeatures:[...(p.metadata?.top_features??[]),...(p.metadata?.tech_specs??[]),...(p.metadata?.unique_selling_points??[])],
    inferredAttributes:[...(p.options??[]),...(p.metadata?.attributes??[])].map(a=>JSON.stringify(a).slice(0,2000)),descriptionTrust:'UNTRUSTED_OR_INFERRED',observedAt:new Date().toISOString()}});
  if(results.length>=10)return results;
 }
 return results.slice(0,10);
}
export class ShopifyGlobalCatalogConnector implements CommerceConnector{
 private readonly client:ShopifyCatalogClient;
 constructor(private readonly env:ShopifyMcpEnv,fetcher?:typeof fetch,private readonly destination='US',private readonly currency='USD'){this.client=new ShopifyCatalogClient(env,fetcher);}
 info(){return {id:'shopify-global-catalog',name:'Shopify Global Catalog MCP',kind:'SHOPIFY' as const,enabled:shopifyMcpConfigured(this.env),description:'Live UCP discovery only. Inferred attributes are not hard policy evidence; checkout is disabled.'};}
 async discover(tool:CatalogTool,input:{query?:string;ids?:string[];id?:string;limit?:number}){
  const shared={context:{address_country:this.destination,currency:this.currency},filters:{ships_to:{country:this.destination},available:false as const}};
  const args=tool==='search_catalog'?{...shared,query:input.query,pagination:{limit:input.limit??10}}:tool==='lookup_catalog'?{...shared,ids:input.ids}:{...shared,id:input.id};
  return normalizeCatalog(await this.client.call(tool,args),tool,this.destination,tool==='search_catalog'?[]:input.ids??[input.id!]);
 }
 async search(query:CommerceSearchQuery){return this.discover('search_catalog',{query:query.query,limit:query.limit});}
 async getProduct(id:string){return (await this.discover('get_product',{id})).find(p=>p.id===id)??null;}
}
