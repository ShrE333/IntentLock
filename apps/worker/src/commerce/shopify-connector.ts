import type {
  CommerceConnector,
  CommerceConnectorInfo,
  CommerceProduct,
  CommerceSearchQuery
} from "./types";

export type ShopifyConnectorConfig = {
  storeDomain:string;
  publicToken?:string;
  privateToken?:string;
  apiVersion?:string;
};

type FetchLike = typeof fetch;

const STOPWORDS=new Set([
  "find","me","a","an","the","or","and","with","under","below","above",
  "buy","purchase","automatically","automatic","if","allowed","for","of",
  "to","in","on","please","want","need","rupees","rs","inr"
]);

function norm(v:string){
  return v.trim().toLowerCase();
}

export function normalizeShopifyDomain(input:string){
  return input
    .trim()
    .replace(/^https?:\/\//i,"")
    .replace(/\/+$/,"")
    .split("/")[0];
}

function searchWords(input:string){
  return norm(input)
    .replace(/[₹$€£,.:;!?()[\]{}"']/g," ")
    .split(/\s+/)
    .filter(Boolean)
    .filter(x=>!STOPWORDS.has(x))
    .filter(x=>!/^\d+(?:\.\d+)?$/.test(x));
}

function unique(values:string[]){
  return [...new Set(values.map(x=>x.trim()).filter(Boolean))];
}

function chooseVariant(product:any){
  const variants=Array.isArray(product?.variants?.nodes)
    ? product.variants.nodes
    : [];

  const available=variants.filter((v:any)=>v?.availableForSale!==false);
  const pool=available.length?available:variants;

  return pool
    .filter((v:any)=>Number.isFinite(Number(v?.price?.amount)))
    .sort(
      (a:any,b:any)=>
        Number(a.price.amount)-Number(b.price.amount)
    )[0]??null;
}

export function normalizeShopifyProduct(
  raw:any,
  storeDomain:string,
  merchantName?:string
):CommerceProduct|null{
  if(!raw?.id || !raw?.title) return null;

  const variant=chooseVariant(raw);
  if(!variant?.id || !variant?.price) return null;

  const price=Number(variant.price.amount);
  if(!Number.isFinite(price)||price<=0) return null;

  const selectedOptions=Array.isArray(variant.selectedOptions)
    ? variant.selectedOptions.flatMap((x:any)=>[
        String(x?.name??""),
        String(x?.value??"")
      ])
    : [];

  const features=unique([
    ...(Array.isArray(raw.tags)?raw.tags.map(String):[]),
    String(raw.productType??""),
    ...selectedOptions
  ]);

  const handle=String(raw.handle??"").trim();
  const onlineStoreUrl=raw.onlineStoreUrl
    ? String(raw.onlineStoreUrl)
    : handle
      ? `https://${storeDomain}/products/${encodeURIComponent(handle)}`
      : undefined;

  return {
    // Variant ID is used as the transaction identity because price is variant-specific.
    id:String(variant.id),
    title:String(raw.title),
    brand:String(raw.vendor||"Unknown"),
    category:String(raw.productType||"uncategorized"),
    merchant:String(merchantName||`Shopify · ${storeDomain}`),
    price,
    currency:String(variant.price.currencyCode||"INR").toUpperCase(),
    quantityAvailable:variant.availableForSale===false?0:1,
    features,
    productUrl:onlineStoreUrl,
    imageUrl:raw?.featuredImage?.url?String(raw.featuredImage.url):undefined,

    // Merchant-controlled description stays explicitly untrusted.
    merchantMessage:raw.description?String(raw.description):undefined
  };
}

export function rankShopifyProducts(
  products:CommerceProduct[],
  query:CommerceSearchQuery
){
  const words=searchWords(query.query);
  const brands=(query.brands??[]).map(norm);
  const required=(query.requiredFeatures??[]).map(norm);

  return products
    .map(product=>{
      let score=0;

      const title=norm(product.title);
      const brand=norm(product.brand);
      const category=norm(product.category);
      const features=product.features.map(norm);

      const haystack=norm([
        product.title,
        product.brand,
        product.category,
        ...product.features
      ].join(" "));

      for(const word of words){
        if(title.includes(word)) score+=5;
        else if(brand.includes(word)) score+=4;
        else if(category.includes(word)) score+=3;
        else if(haystack.includes(word)) score+=2;
      }

      if(query.category && category===norm(query.category)) score+=6;
      if(brands.length && brands.includes(brand)) score+=5;

      for(const feature of required){
        if(features.includes(feature)) score+=3;
        else if(haystack.includes(feature)) score+=1;
      }

      // Ranking hint only. Wallet policy is still authoritative.
      if(query.maxPrice && product.price<=query.maxPrice) score+=1;
      if(product.quantityAvailable<=0) score-=100;

      return {product,score};
    })
    .filter(x=>x.product.quantityAvailable>0)
    .filter(x=>x.score>0 || words.length===0)
    .sort((a,b)=>b.score-a.score || a.product.price-b.product.price)
    .slice(0,Math.max(1,Math.min(query.limit??10,25)))
    .map(x=>x.product);
}

const PRODUCT_BASE_FIELDS=`
  id
  handle
  title
  description
  vendor
  productType
  tags
  onlineStoreUrl
  featuredImage { url altText }
`;

const PRODUCT_FIELDS=`
  ${PRODUCT_BASE_FIELDS}
  variants(first: 10) {
    nodes {
      id
      title
      availableForSale
      price { amount currencyCode }
      selectedOptions { name value }
    }
  }
`;

export class ShopifyStorefrontConnector implements CommerceConnector {
  private readonly domain:string;
  private readonly version:string;

  constructor(
  private readonly config: ShopifyConnectorConfig,
  private readonly fetcher: FetchLike = globalThis.fetch.bind(globalThis)
) {
    this.domain=normalizeShopifyDomain(config.storeDomain);
    this.version=config.apiVersion||"2026-07";
  }

  info():CommerceConnectorInfo{
    return {
      id:"shopify-storefront",
      name:"Shopify Storefront",
      kind:"SHOPIFY",
      enabled:Boolean(
        this.domain &&
        (this.config.privateToken||this.config.publicToken)
      ),
      description:
        "Live Shopify Storefront API catalog. Merchant descriptions remain untrusted and policy is evaluated by IntentLock."
    };
  }

  private async graphql(query:string,variables:Record<string,unknown>){
    if(!this.info().enabled) throw new Error("SHOPIFY_NOT_CONFIGURED");

    const headers:Record<string,string>={
      "content-type":"application/json",
      "accept":"application/json"
    };

    if(this.config.privateToken){
      headers["Shopify-Storefront-Private-Token"]=this.config.privateToken;
    }else if(this.config.publicToken){
      headers["X-Shopify-Storefront-Access-Token"]=this.config.publicToken;
    }

    const response=await this.fetcher(
      `https://${this.domain}/api/${this.version}/graphql.json`,
      {
        method:"POST",
        headers,
        body:JSON.stringify({query,variables})
      }
    );

    const body:any=await response.json();

    if(!response.ok){
      throw new Error(
        `SHOPIFY_HTTP_${response.status}:${body?.errors?.[0]?.message??"Storefront request failed"}`
      );
    }

    if(Array.isArray(body?.errors)&&body.errors.length){
      throw new Error(`SHOPIFY_GRAPHQL:${body.errors[0]?.message??"Unknown GraphQL error"}`);
    }

    return body?.data;
  }

  async search(query:CommerceSearchQuery):Promise<CommerceProduct[]>{
    // For the demo store we deliberately fetch a bounded catalog and rank locally.
    // This lets natural-language prompts work reliably instead of passing an LLM-style
    // sentence into Shopify's structured search grammar.
    const data=await this.graphql(
      `query IntentLockCatalog($first:Int!){
        shop { name }
        products(first:$first){
          nodes { ${PRODUCT_FIELDS} }
        }
      }`,
      {first:50}
    );

    const merchantName=String(data?.shop?.name||`Shopify · ${this.domain}`);

    const normalized=(data?.products?.nodes??[])
      .map((p:any)=>normalizeShopifyProduct(p,this.domain,merchantName))
      .filter(Boolean) as CommerceProduct[];

    return rankShopifyProducts(normalized,query);
  }

  async getProduct(id:string):Promise<CommerceProduct|null>{
    if(!id) return null;

    const data=await this.graphql(
      `query IntentLockVariant($id:ID!){
        shop { name }
        node(id:$id){
          ... on ProductVariant {
            id
            title
            availableForSale
            price { amount currencyCode }
            selectedOptions { name value }
            product { ${PRODUCT_BASE_FIELDS} }
          }
        }
      }`,
      {id}
    );

    const variant=data?.node;
    const product=variant?.product;
    if(!variant||!product) return null;

    // Inject the exact requested variant into the same normalizer shape.
    const shape={
      ...product,
      variants:{nodes:[variant]}
    };

    return normalizeShopifyProduct(
      shape,
      this.domain,
      String(data?.shop?.name||`Shopify · ${this.domain}`)
    );
  }
}
