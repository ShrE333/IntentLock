import type {
  CommerceConnector,
  CommerceConnectorInfo,
  CommerceProduct,
  CommerceSearchQuery
} from "./types";

export type EbayEnvironment="sandbox"|"production";

export type EbayBrowseConfig={
  clientId:string;
  clientSecret:string;
  environment?:EbayEnvironment|string;
  marketplaceId?:string;
  endUserCountry?:string;
  endUserPostalCode?:string;
  fetchImpl?:typeof fetch;
};

type JsonRecord=Record<string,any>;
type TokenCacheEntry={token:string;expiresAt:number};

const tokenCache=new Map<string,TokenCacheEntry>();
const DEFAULT_SCOPE="https://api.ebay.com/oauth/api_scope";

const MARKETPLACE_COUNTRY:Record<string,string>={
  EBAY_AT:"AT",EBAY_AU:"AU",EBAY_BE:"BE",EBAY_CA:"CA",EBAY_CH:"CH",
  EBAY_DE:"DE",EBAY_ES:"ES",EBAY_FR:"FR",EBAY_GB:"GB",EBAY_HK:"HK",
  EBAY_IE:"IE",EBAY_IT:"IT",EBAY_NL:"NL",EBAY_PL:"PL",EBAY_SG:"SG",EBAY_US:"US"
};

const clean=(value:unknown)=>String(value??"").trim();
const upper=(value:unknown)=>clean(value).toUpperCase();
const lower=(value:unknown)=>clean(value).toLowerCase();
const finiteNumber=(value:unknown)=>{
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};
const unique=(values:string[])=>[...new Set(values.map(v=>v.trim()).filter(Boolean))];

function normalizeEnvironment(value:unknown):EbayEnvironment{
  return lower(value)==="production"?"production":"sandbox";
}

function normalizeMarketplace(value:unknown){
  const marketplace=upper(value||"EBAY_US");
  return /^EBAY_[A-Z]{2}$/.test(marketplace)?marketplace:"EBAY_US";
}

function apiBase(environment:EbayEnvironment){
  return environment==="production"?"https://api.ebay.com":"https://api.sandbox.ebay.com";
}

function safeApiError(body:unknown){
  if(!body||typeof body!=="object") return "UNKNOWN";
  const record=body as JsonRecord;
  const first=Array.isArray(record.errors)?record.errors[0]:null;
  const id=clean(first?.errorId||first?.errorCode||record.error);
  return id||"UNKNOWN";
}

function aspectEntries(item:JsonRecord){
  const aspects=Array.isArray(item.localizedAspects)?item.localizedAspects:[];
  return aspects
    .map((a:any)=>({name:clean(a?.name),value:clean(a?.value)}))
    .filter((a:{name:string;value:string})=>a.name&&a.value);
}

function inferBrand(item:JsonRecord){
  const direct=clean(item.brand);
  if(direct) return direct;
  const names=new Set(["brand","marke","marque","marca","merk"]);
  const aspect=aspectEntries(item).find(a=>names.has(lower(a.name)));
  return aspect?.value||"Unknown";
}

function inferCategory(item:JsonRecord){
  const categoryParts:string[]=[];
  if(clean(item.categoryPath)) categoryParts.push(clean(item.categoryPath));
  if(Array.isArray(item.categories)){
    for(const c of item.categories) if(clean(c?.categoryName)) categoryParts.push(clean(c.categoryName));
  }
  const raw=categoryParts.join(" | ").toLowerCase();
  if(/consumer electronics|electronic|headphone|audio|computer|laptop|tablet|cell phone|smartphone|camera|television|video game|console|wearable/.test(raw)) return "electronics";
  if(/clothing|shoe|fashion|apparel|jewelry|jewellery|watches/.test(raw)) return "fashion";
  if(/home|garden|furniture|kitchen|appliance/.test(raw)) return "home";
  if(/sport|fitness|outdoor/.test(raw)) return "sports";
  if(/vehicle|automotive|car|motorcycle|parts & accessories/.test(raw)) return "automotive";
  if(/collectible|memorabilia|coin|stamp/.test(raw)) return "collectibles";
  if(/book|music|movie|dvd|media/.test(raw)) return "media";
  return "other";
}

function inferFeatures(item:JsonRecord){
  // Only derive policy-facing features from eBay's structured aspect fields.
  // The listing title/description remain merchant-controlled text and are never
  // converted into authorization facts here.
  const aspects=aspectEntries(item);
  const featureValues=aspects.flatMap(a=>[a.name,a.value]);
  const haystack=featureValues.join(" ").toLowerCase();
  const features:string[]=[];

  if(/wireless|cordless/.test(haystack)) features.push("wireless");
  if(/active noise cancel|active noise cancell|\banc\b/.test(haystack)) features.push("ANC");
  if(/bluetooth/.test(haystack)) features.push("Bluetooth");
  if(/multipoint|multi-point/.test(haystack)) features.push("multipoint");
  if(/usb[- ]?c|type[- ]?c/.test(haystack)) features.push("USB-C");
  if(/water.?resistant|waterproof/.test(haystack)) features.push("water-resistant");
  if(/noise cancel|noise cancell/.test(haystack)) features.push("noise-cancelling");

  // Preserve short structured aspect values as additional deterministic facts.
  // Long prose-like aspect values are intentionally excluded.
  for(const {value} of aspects){
    if(value.length<=40 && !/[.!?]\s/.test(value)) features.push(value);
  }
  return unique(features);
}

function quantityAvailable(item:JsonRecord){
  const availabilities=Array.isArray(item.estimatedAvailabilities)?item.estimatedAvailabilities:[];
  if(availabilities.some((a:any)=>upper(a?.estimatedAvailabilityStatus)==="OUT_OF_STOCK")) return 0;
  for(const a of availabilities){
    const remaining=finiteNumber(a?.estimatedRemainingQuantity);
    if(remaining!=null) return Math.max(0,Math.floor(remaining));
  }
  return 1;
}

function itemCountry(item:JsonRecord,marketplaceId:string){
  const country=upper(item?.itemLocation?.country);
  if(/^[A-Z]{2}$/.test(country)) return country;
  return MARKETPLACE_COUNTRY[marketplaceId]??"US";
}

function mapDetailedItem(item:JsonRecord,marketplaceId:string):CommerceProduct|null{
  const id=clean(item.itemId);
  const title=clean(item.title);
  const price=finiteNumber(item?.price?.value);
  const currency=upper(item?.price?.currency);
  if(!id||!title||price==null||price<0||!/^[A-Z]{3}$/.test(currency)) return null;

  const seller=clean(item?.seller?.username||item?.seller?.userId)||"eBay seller";
  const description=clean(item.shortDescription);
  const condition=clean(item.condition);
  const message=[description,condition?`Condition: ${condition}`:""].filter(Boolean).join(" · ").slice(0,800);

  return {
    id,
    title,
    brand:inferBrand(item),
    category:inferCategory(item),
    merchant:seller,
    merchantCountry:itemCountry(item,marketplaceId),
    price,
    currency,
    quantityAvailable:quantityAvailable(item),
    features:inferFeatures(item),
    productUrl:clean(item.itemAffiliateWebUrl||item.itemWebUrl)||undefined,
    imageUrl:clean(item?.image?.imageUrl)||undefined,
    merchantMessage:message||undefined,
    source:{provider:"ebay",marketplaceId,listingId:id,payeeId:seller,payeeType:"EBAY_SELLER"}
  };
}

export class EbayBrowseConnector implements CommerceConnector{
  private clientId:string;
  private clientSecret:string;
  private environment:EbayEnvironment;
  private marketplaceId:string;
  private endUserCountry?:string;
  private endUserPostalCode?:string;
  private fetchImpl:typeof fetch;

  constructor(config:EbayBrowseConfig){
    this.clientId=clean(config.clientId);
    this.clientSecret=clean(config.clientSecret);
    if(!this.clientId||!this.clientSecret) throw new Error("EBAY_CREDENTIALS_REQUIRED");
    this.environment=normalizeEnvironment(config.environment);
    this.marketplaceId=normalizeMarketplace(config.marketplaceId);
    this.endUserCountry=/^[A-Z]{2}$/.test(upper(config.endUserCountry))?upper(config.endUserCountry):undefined;
    this.endUserPostalCode=clean(config.endUserPostalCode)||undefined;
    this.fetchImpl=config.fetchImpl??fetch;
  }

  info():CommerceConnectorInfo{
    return {
      id:"ebay-browse",
      name:`eBay Browse · ${this.marketplaceId}`,
      kind:"EBAY",
      enabled:true,
      description:"Live eBay Browse API discovery with structured-fact mapping and execution-time listing revalidation."
    };
  }

  private cacheKey(){return `${this.environment}:${this.clientId}`;}

  private clearToken(){tokenCache.delete(this.cacheKey());}

  private async applicationToken(){
    const cached=tokenCache.get(this.cacheKey());
    if(cached&&cached.expiresAt>Date.now()+30_000) return cached.token;

    const credentials=btoa(`${this.clientId}:${this.clientSecret}`);
    const body=new URLSearchParams({grant_type:"client_credentials",scope:DEFAULT_SCOPE});
    const response=await this.fetchImpl(`${apiBase(this.environment)}/identity/v1/oauth2/token`,{
      method:"POST",
      headers:{authorization:`Basic ${credentials}`,"content-type":"application/x-www-form-urlencoded"},
      body:body.toString()
    });
    const payload=await response.json().catch(()=>({})) as JsonRecord;
    if(!response.ok) throw new Error(`EBAY_OAUTH_HTTP_${response.status}:${safeApiError(payload)}`);
    const token=clean(payload.access_token);
    const expires=finiteNumber(payload.expires_in)??7200;
    if(!token) throw new Error("EBAY_OAUTH_TOKEN_MISSING");
    tokenCache.set(this.cacheKey(),{token,expiresAt:Date.now()+Math.max(60,expires-60)*1000});
    return token;
  }

  private endUserContext(){
    if(!this.endUserCountry) return undefined;
    const pieces=[`country=${this.endUserCountry}`];
    if(this.endUserPostalCode) pieces.push(`zip=${this.endUserPostalCode}`);
    return `contextualLocation=${pieces.join(",")}`;
  }

  private async apiGet(path:string,params?:URLSearchParams,retry401=true):Promise<JsonRecord>{
    const token=await this.applicationToken();
    const url=`${apiBase(this.environment)}${path}${params&&String(params)?`?${params}`:""}`;
    const headers:Record<string,string>={
      authorization:`Bearer ${token}`,
      "x-ebay-c-marketplace-id":this.marketplaceId,
      accept:"application/json"
    };
    const context=this.endUserContext();
    if(context) headers["x-ebay-c-enduserctx"]=context;

    const response=await this.fetchImpl(url,{method:"GET",headers});
    const payload=await response.json().catch(()=>({})) as JsonRecord;
    if(response.status===401&&retry401){
      this.clearToken();
      return this.apiGet(path,params,false);
    }
    if(!response.ok) throw new Error(`EBAY_BROWSE_HTTP_${response.status}:${safeApiError(payload)}`);
    return payload;
  }

  private async getDetailedProduct(itemId:string){
    const id=clean(itemId);
    if(!id) return null;
    const payload=await this.apiGet(`/buy/browse/v1/item/${encodeURIComponent(id)}`);
    return mapDetailedItem(payload,this.marketplaceId);
  }

  async search(query:CommerceSearchQuery):Promise<CommerceProduct[]>{
    const q=clean(query.query);
    if(!q) return [];
    const limit=Math.max(1,Math.min(Math.floor(Number(query.limit??8)),10));
    const params=new URLSearchParams({
      q,
      limit:String(limit),
      fieldgroups:"EXTENDED",
      filter:"buyingOptions:{FIXED_PRICE}"
    });
    const payload=await this.apiGet("/buy/browse/v1/item_summary/search",params);
    const summaries=Array.isArray(payload.itemSummaries)?payload.itemSummaries.slice(0,limit):[];
    const results=await Promise.all(summaries.map(async(summary:any)=>{
      try{return await this.getDetailedProduct(clean(summary?.itemId));}
      catch{return null;}
    }));
    const products=results.filter((p):p is CommerceProduct=>Boolean(p));
    if(summaries.length>0&&products.length===0) throw new Error("EBAY_DETAIL_REFRESH_FAILED");
    // Preserve eBay's result order; do not locally re-sort Browse results.
    return products;
  }

  async getProduct(id:string){
    return this.getDetailedProduct(id);
  }
}
