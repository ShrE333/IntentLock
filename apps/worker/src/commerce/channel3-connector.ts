import {z} from 'zod';
import type {CommerceConnector,CommerceProduct,CommerceSearchQuery} from './types';
import {CatalogError} from './shopify-mcp';
import {validCurrency} from '../wallets/validation';

export const CHANNEL3_ENDPOINT='https://api.trychannel3.com';
export type Channel3Env={CHANNEL3_ENABLED?:string;CHANNEL3_API_KEY?:string;CHANNEL3_COUNTRY?:string;CHANNEL3_TIMEOUT_MS?:string};
// Semantic search is slow from some regions; default 20s, strictly parsed and capped at 30s.
export const channel3TimeoutMs=(env:Channel3Env)=>{const raw=String(env.CHANNEL3_TIMEOUT_MS??'').trim();const n=/^\d{4,5}$/.test(raw)?Number(raw):NaN;return n>=3000&&n<=30000?n:20000;};
export const channel3Enabled=(env:Channel3Env)=>env.CHANNEL3_ENABLED==='true'&&typeof env.CHANNEL3_API_KEY==='string'&&env.CHANNEL3_API_KEY.trim().length>0;
const countryOf=(env:Channel3Env)=>typeof env.CHANNEL3_COUNTRY==='string'&&/^[A-Z]{2}$/.test(env.CHANNEL3_COUNTRY)?env.CHANNEL3_COUNTRY:'US';
const PREFIX='c3_';
const offerSchema=z.object({url:z.string().max(2000),domain:z.string().trim().min(1).max(253),
 price:z.object({price:z.number(),currency:z.string()}),availability:z.string()});
const productSchema=z.object({id:z.string().trim().min(1).max(200),title:z.string().trim().min(1).max(500),description:z.string().nullish(),
 brands:z.array(z.object({name:z.string()})).default([]),images:z.array(z.object({url:z.string(),alt_text:z.string().nullish()})).default([]),
 category:z.object({title:z.string(),slug:z.string().optional(),path:z.array(z.object({title:z.string()})).optional()}).nullish(),
 key_features:z.array(z.string()).nullish(),offers:z.array(z.unknown()).default([])});
const searchResponse=z.object({products:z.array(z.unknown()).max(100)});
const clean=(s:string)=>s.replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').replace(/\s{2,}/g,' ').trim();
const httpUrl=(v:string)=>{try{const u=new URL(v);return (u.protocol==='https:'||u.protocol==='http:')&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}};
// Categories are third-party facts, but demo wallets express policy as coarse buckets like 'electronics'.
function category(c:z.infer<typeof productSchema>['category']){
 if(!c)return 'uncategorized';
 const raw=[c.slug,c.title,...(c.path??[]).map(p=>p.title)].join(' | ').toLowerCase();
 if(/electronic|audio|headphone|earbud|speaker|computer|laptop|tablet|phone|camera|television|wearable/.test(raw))return 'electronics';
 return c.title.trim().toLowerCase()||'uncategorized';
}
export function normalizeChannel3Product(raw:unknown):CommerceProduct|null{
 const p=productSchema.safeParse(raw);if(!p.success)return null;
 const d=p.data;
 let offer:z.infer<typeof offerSchema>|undefined;
 for(const o of d.offers){const x=offerSchema.safeParse(o);
  if(x.success&&x.data.availability==='InStock'&&Number.isFinite(x.data.price.price)&&x.data.price.price>0&&validCurrency(x.data.price.currency.toUpperCase())&&httpUrl(x.data.url)){offer=x.data;break;}}
 if(!offer)return null;
 const features=(d.key_features??[]).map(f=>clean(f)).filter(f=>f&&f.length<=80).slice(0,10);
 const image=d.images.map(i=>httpUrl(i.url)).find(Boolean);
 const text=d.description?clean(d.description).slice(0,300):'';
 return {id:PREFIX+d.id,title:clean(d.title),brand:clean(d.brands[0]?.name??'')||'Unknown',category:category(d.category),merchant:offer.domain,
  price:offer.price.price,currency:offer.price.currency.toUpperCase(),quantityAvailable:1,features,productUrl:httpUrl(offer.url),imageUrl:image,
  merchantMessage:text||undefined,
  source:{provider:'channel3',listingId:d.id,marketplaceId:offer.domain,payeeId:offer.domain,payeeType:'EXTERNAL_PAYEE'}};
}
async function boundedJson(response:Response){
 if(!response.body)throw new CatalogError('CHANNEL3_RESPONSE_INVALID');
 const reader=response.body.getReader();const decoder=new TextDecoder();let size=0,text='';
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>1048576){await reader.cancel();throw new CatalogError('CHANNEL3_RESPONSE_INVALID');}text+=decoder.decode(value,{stream:true});}
 text+=decoder.decode();}finally{reader.releaseLock();}
 try{return JSON.parse(text) as unknown;}catch{throw new CatalogError('CHANNEL3_RESPONSE_INVALID');}
}
export class Channel3Connector implements CommerceConnector{
 constructor(private readonly env:Channel3Env,private readonly fetcher:typeof fetch=globalThis.fetch.bind(globalThis),private readonly timeoutMs=channel3TimeoutMs(env)){}
 info(){return {id:'channel3-catalog',name:'Channel3 Product Catalog',kind:'CHANNEL3' as const,enabled:channel3Enabled(this.env),description:'Real product listings, discovery only. Sellers are not verified payees; checkout is disabled.'};}
 private async call(path:string,init:{method:'GET'|'POST';body?:unknown}):Promise<unknown>{
  if(!channel3Enabled(this.env))throw new CatalogError('CHANNEL3_DISABLED',503);
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),this.timeoutMs);
  try{
   const response=await this.fetcher(CHANNEL3_ENDPOINT+path,{method:init.method,redirect:'manual',signal:abort.signal,
    headers:{'x-api-key':this.env.CHANNEL3_API_KEY!.trim(),accept:'application/json',...(init.body?{'content-type':'application/json'}:{})},
    ...(init.body?{body:JSON.stringify(init.body)}:{})});
   // 'manual' (Workers reject 'error'): a redirect is not ok and is refused below.
   if(response.status===429)throw new CatalogError('CHANNEL3_RATE_LIMITED',429);
   if(response.status===404)return null;
   if(!response.ok)throw new CatalogError('CHANNEL3_UNAVAILABLE',502);
   return await boundedJson(response);
  }catch(error){if(error instanceof CatalogError)throw error;throw new CatalogError(abort.signal.aborted?'CHANNEL3_TIMEOUT':'CHANNEL3_UNAVAILABLE',abort.signal.aborted?504:502);}
  finally{clearTimeout(timer);}
 }
 async search(query:CommerceSearchQuery){
  // Wallet policy (brands/maxPrice/requiredFeatures) is deliberately never forwarded: discovery is not pre-filtered.
  const limit=Math.max(1,Math.min(Math.floor(Number(query.limit??12))||12,30));
  const raw=await this.call('/v1/search',{method:'POST',body:{query:query.query,limit,config:{country:countryOf(this.env),currency:'USD'}}});
  const parsed=searchResponse.safeParse(raw);if(!parsed.success)throw new CatalogError('CHANNEL3_RESPONSE_INVALID');
  return parsed.data.products.flatMap(p=>normalizeChannel3Product(p)??[]);
 }
 async getProduct(id:string){
  const bare=id.startsWith(PREFIX)?id.slice(PREFIX.length):id;
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(bare))return null;
  const raw=await this.call(`/v1/products/${encodeURIComponent(bare)}?country=${countryOf(this.env)}&currency=USD`,{method:'GET'});
  return raw===null?null:normalizeChannel3Product(raw);
 }
}
