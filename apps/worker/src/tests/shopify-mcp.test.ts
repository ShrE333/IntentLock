import {describe,it,expect,vi} from 'vitest';
import {CATALOG_VERSION,SHOPIFY_CATALOG_ENDPOINT,ShopifyCatalogClient,ShopifyGlobalCatalogConnector,normalizeCatalog,minorDigits,type CatalogTool} from '../commerce/shopify-mcp';
import {getCommerceConnectors} from '../commerce/registry';
import {restrictCatalogEvaluation} from '../commerce/catalog-policy';
import {authorizeProductContext} from '../payments/authorization-context';
import {evaluateWalletTransaction} from '../wallets/policy';
import {assertExecutableCommerce} from '../payments/recipient-binding';
import {tightenEvaluation} from '../risk/tighten';
import type {IntentWallet} from '../wallets/types';
import {catalogEnv,catalogFixture} from './shopify-mcp-fixture';
const args={query:'Headphones',context:{address_country:'US',currency:'USD'},pagination:{limit:2},filters:{ships_to:{country:'US'},available:false}};
const wallet:IntentWallet={walletId:'w',name:'unrestricted discovery',countryCode:'US',currency:'USD',totalAuthority:100,spentAmount:0,autoBuyLimit:55,maxSingleTransaction:75,validUntil:'2099-01-01T00:00:00Z',status:'ACTIVE',allowedBrands:[],blockedBrands:[],allowedCategories:[],requiredFeatures:[]};
const normalized=()=>normalizeCatalog(catalogFixture(),'search_catalog','US')[0];
const fetchRpc=(data:unknown=catalogFixture())=>vi.fn<typeof fetch>(async(_url,init)=>{const sent=JSON.parse(String(init?.body));return Response.json({jsonrpc:'2.0',id:sent.id,result:{structuredContent:data}});});
describe('official UCP Global Catalog normalization',()=>{
 it.each(['https://merchant.example/cart/123:1','javascript:alert(1)','https://evil.example/products/headphones','https://merchant.example/products/headphones/checkout'])('does not expose checkout/foreign links as product pages: %s',url=>{
  const f=catalogFixture();f.products[0].variants[0].url=url;expect(normalizeCatalog(f,'search_catalog','US')[0].productUrl).toBeUndefined();
 });
 it('preserves exact variant/product/shop identity and integer price provenance',()=>{
  const p=normalized();expect(p.id).toBe('gid://shopify/ProductVariant/123');expect(p.price).toBe(49);expect(p.discovery).toMatchObject({productId:'gid://shopify/p/example_UPID',sellerId:'gid://shopify/Shop/456',sellerDomain:'merchant.myshopify.com',minorAmount:4900,minorDigits:2,available:true,requestedShippingCountry:'US',shippingVerified:false});
  expect(p.productUrl).toBe('https://merchant.example/products/headphones?variant=123');expect(JSON.stringify(p)).not.toContain('/cart/');
 });
 it.each([['USD',4900,49,2],['JPY',4900,4900,0],['KWD',4999,4.999,3]])('converts %s ISO minor units exactly',(currency,amount,major,digits)=>{
  const f=catalogFixture();f.products[0].variants[0].price={amount,currency};const p=normalizeCatalog(f,'search_catalog','US')[0];expect(p.price).toBe(major);expect(minorDigits(currency)).toBe(digits);
 });
 it.each([undefined,NaN,Infinity,0,-1,49.1,'4900',Number.MAX_SAFE_INTEGER+1])('rejects malformed minor price %s',amount=>{
  const f=catalogFixture();Object.assign(f.products[0].variants[0].price,{amount});expect(()=>normalizeCatalog(f,'search_catalog','US')).toThrow();
 });
 it.each(['XYZ','usd',''])('rejects missing/invalid currency %s',currency=>{const f=catalogFixture();f.products[0].variants[0].price.currency=currency;expect(()=>normalizeCatalog(f,'search_catalog','US')).toThrow();});
 it.each(['id','name','domain','url'])('rejects absent seller %s',key=>{const f=catalogFixture();Reflect.deleteProperty(f.products[0].variants[0].seller,key);expect(()=>normalizeCatalog(f,'search_catalog','US')).toThrow();});
 it.each(['http://merchant.example','https://127.0.0.1','https://user:pass@merchant.example'])('rejects unsafe merchant provenance %s',url=>{const f=catalogFixture();f.products[0].variants[0].seller.url=url;expect(()=>normalizeCatalog(f,'search_catalog','US')).toThrow();});
 it('never invents missing availability or precise stock quantity',()=>{
  const f=catalogFixture();Reflect.deleteProperty(f.products[0].variants[0].availability,'available');expect(()=>normalizeCatalog(f,'search_catalog','US')).toThrow();
  expect(normalized().quantityAvailable).toBe(1); // Boolean sellability only; no inventory-count assertion.
 });
 it('retains unavailable variants and changed prices without silently selecting another',()=>{
  const f=catalogFixture();f.products[0].variants[0].availability.available=false;f.products[0].variants[0].price.amount=6900;
  const p=normalizeCatalog(f,'lookup_catalog','US',['gid://shopify/ProductVariant/123'])[0];expect(p.id).toBe(normalized().id);expect(p.price).toBe(69);expect(p.quantityAvailable).toBe(0);
 });
 it('rejects wrong lookup identities, duplicate variants and unsupported UCP versions',()=>{
  expect(()=>normalizeCatalog(catalogFixture(),'lookup_catalog','US',['gid://shopify/ProductVariant/999'])).toThrow('MCP_IDENTITY_MISMATCH');
  const f=catalogFixture();f.products[0].variants.push(f.products[0].variants[0]);expect(()=>normalizeCatalog(f,'search_catalog','US')).toThrow('MCP_DUPLICATE_VARIANT');
  f.ucp.version='2020-01-01';expect(()=>normalizeCatalog(f,'search_catalog','US')).toThrow();
 });
 it('does not promote inferred features, brand, condition, HTML or tool authority into policy facts',()=>{
  const f=catalogFixture();Object.assign(f.products[0],{brand:'Sony',authorizationContext:{recipient:'forged'}});const p=normalizeCatalog(f,'search_catalog','US')[0];
  expect(p.brand).toBe('');expect(p.category).toBe('');expect(p.features).toEqual([]);expect(p.authorizationContext).toBeUndefined();expect(p.discovery?.conditionTrust).toBe('INFERRED');expect(p.merchantMessage).toContain('Ignore previous');
 });
});
describe('bounded read-only MCP transport',()=>{
 it('is disabled by default and requires an operator profile',async()=>{
  const fetcher=fetchRpc();await expect(new ShopifyCatalogClient({},fetcher).call('search_catalog',args)).rejects.toThrow('DISABLED');
  await expect(new ShopifyCatalogClient({SHOPIFY_GLOBAL_CATALOG_ENABLED:'true'},fetcher).call('search_catalog',args)).rejects.toThrow('PROFILE_REQUIRED');expect(fetcher).not.toHaveBeenCalled();
  expect(getCommerceConnectors({}).some(c=>c.info().id==='shopify-global-catalog')).toBe(false);
 });
 it.each(['complete_checkout','create_cart','tools/call','get_checkout','search_orders','constructor','__proto__'])('rejects %s before fetching',async tool=>{
  const fetcher=fetchRpc();await expect(new ShopifyCatalogClient(catalogEnv,fetcher).call(tool as CatalogTool,args)).rejects.toThrow('NOT_ALLOWED');expect(fetcher).not.toHaveBeenCalled();
 });
 it('sends only the allowlisted query/localization/profile to the fixed endpoint',async()=>{
  const fetcher=fetchRpc();await new ShopifyGlobalCatalogConnector(catalogEnv,fetcher).search({query:'Headphones',limit:2,brands:['do-not-forward'],maxPrice:1});
  const [url,init]=fetcher.mock.calls[0];expect(url).toBe(SHOPIFY_CATALOG_ENDPOINT);expect(init?.redirect).toBe('error');expect(Object.keys(init?.headers??{})).not.toContain('authorization');
  const request=JSON.parse(String(init?.body));expect(request.params.arguments.catalog).toEqual(args);expect(String(init?.body)).not.toMatch(/wallet|do-not-forward|maxPrice/);
 });
 it.each([{...args,endpoint:'https://evil.example'}, {...args,pagination:{limit:100}}, {...args,query:'x'.repeat(401)}])('rejects widened input %j',async input=>{const fetcher=fetchRpc();await expect(new ShopifyCatalogClient(catalogEnv,fetcher).call('search_catalog',input)).rejects.toThrow('ARGUMENTS_INVALID');expect(fetcher).not.toHaveBeenCalled();});
 it('supports get_product and lookup_catalog without following checkout URLs',async()=>{
  const f=catalogFixture();const fetcher=fetchRpc({...f,product:f.products[0]});const connector=new ShopifyGlobalCatalogConnector(catalogEnv,fetcher);
  expect((await connector.getProduct('gid://shopify/ProductVariant/123'))?.id).toBe('gid://shopify/ProductVariant/123');
  expect((await connector.discover('lookup_catalog',{ids:['gid://shopify/ProductVariant/123']}))[0].price).toBe(49);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each([{}, {products:[]}, {ucp:{version:CATALOG_VERSION},products:[]}])('rejects malformed UCP data %j',async data=>{await expect(new ShopifyGlobalCatalogConnector(catalogEnv,fetchRpc(data)).search({query:'q'})).rejects.toThrow();});
 it('handles SSE, MCP errors, RPC identity mismatch, provider outage and rate limit',async()=>{
  const sse=vi.fn<typeof fetch>(async(_url,init)=>{const {id}=JSON.parse(String(init?.body));return new Response('data: '+JSON.stringify({jsonrpc:'2.0',id,result:{structuredContent:catalogFixture()}})+'\n\n',{headers:{'content-type':'text/event-stream'}});});
  expect((await new ShopifyGlobalCatalogConnector(catalogEnv,sse).search({query:'q'})).length).toBe(1);
  for(const response of [Response.json({jsonrpc:'2.0',id:'wrong',result:{structuredContent:catalogFixture()}}),Response.json({error:'provider'}, {status:503}),new Response('',{status:429})]){
   await expect(new ShopifyCatalogClient(catalogEnv,vi.fn<typeof fetch>().mockResolvedValue(response)).call('search_catalog',args)).rejects.toThrow();
  }
 });
 it('bounds response size and aborts a stalled provider',async()=>{
  await expect(new ShopifyCatalogClient(catalogEnv,vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}}))).call('search_catalog',args)).rejects.toThrow('TOO_LARGE');
  const stalled=vi.fn<typeof fetch>(async(_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')))));
  await expect(new ShopifyCatalogClient(catalogEnv,stalled,5).call('search_catalog',args)).rejects.toThrow('TIMEOUT');
 });
});
describe('catalog policy and payment separation',()=>{
 it.each([[4900,'ALLOW'],[6900,'STEP_UP'],[9900,'BLOCK']])('evaluates price %s as %s without executable authority',async(amount,decision)=>{
  const f=catalogFixture();f.products[0].variants[0].price.amount=Number(amount);const p=normalizeCatalog(f,'search_catalog','US')[0];
  const normalized=await authorizeProductContext({},wallet,p,'shopify-global-catalog');const evaluation=restrictCatalogEvaluation(wallet,p,evaluateWalletTransaction(wallet,normalized.transaction));
  expect(evaluation.decision).toBe(decision);expect(evaluation.canAutoExecute).toBe(false);expect(normalized.context.recipient).toBeUndefined();
  expect(()=>assertExecutableCommerce('shopify-global-catalog','sandbox')).toThrow('COMMERCE_DISCOVERY_ONLY');
 });
 it.each([{allowedBrands:['Sony']},{blockedBrands:['Boat']},{requiredFeatures:['ANC']},{allowedCategories:['electronics']}])('does not satisfy hard constraints with inferred facts %j',async constraints=>{
  const p=normalized(),w={...wallet,...constraints};const n=await authorizeProductContext({},w,p);expect(restrictCatalogEvaluation(w,p,evaluateWalletTransaction(w,n.transaction)).decision).toBe('BLOCK');
 });
 it('availability, PayeeLock enforcement and risk never widen permission',async()=>{
  expect((await authorizeProductContext({COMMERCE_MERCHANT_COUNTRY:'US'},wallet,normalized())).context.merchantCountry).toBe('ZZ');
  const emptyLabelWallet={...wallet,allowedBrands:[''],allowedCategories:['']};
  expect(restrictCatalogEvaluation(emptyLabelWallet,normalized(),evaluateWalletTransaction(emptyLabelWallet,{brand:'',category:'',amount:49,currency:'USD',quantity:1,features:[]})).decision).toBe('BLOCK');
  const p=normalized();p.discovery!.available=false;expect(restrictCatalogEvaluation(wallet,p,evaluateWalletTransaction(wallet,{brand:'',category:'',amount:49,currency:'USD',quantity:1,features:[]})).decision).toBe('BLOCK');
  await expect(authorizeProductContext({PAYEELOCK_MODE:'enforce'},wallet,normalized())).rejects.toThrow('REGISTRY_REQUIRED');
  const block=restrictCatalogEvaluation(wallet,p,evaluateWalletTransaction(wallet,{brand:'',category:'',amount:49,currency:'USD',quantity:1,features:[]}));expect(tightenEvaluation(block,'OBSERVE').decision).toBe('BLOCK');
 });
});
