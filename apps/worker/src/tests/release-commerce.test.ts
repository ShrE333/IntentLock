import {describe,it,expect,vi} from 'vitest';
import {normalizeShopifyProduct,ShopifyStorefrontConnector} from '../commerce/shopify-connector';
import {assertExecutableCommerce,resolveRecipient} from '../payments/recipient-binding';
const variant={id:'gid://shopify/ProductVariant/11',availableForSale:true,price:{amount:'49.00',currencyCode:'USD'}};
const product=(v:object)=>({id:'gid://shopify/Product/1',title:'Headphones',vendor:'Seller text',variants:{nodes:[v]}});
describe('release Shopify discovery boundaries',()=>{
 it.each([{}, {amount:'49.00'}, {amount:'49.00',currencyCode:'usd'}, {amount:'49.00',currencyCode:'XYZ'}, {amount:'0x31',currencyCode:'USD'}, {amount:'1e2',currencyCode:'USD'}, {amount:'0',currencyCode:'USD'}, {amount:'1.001',currencyCode:'USD'}])('rejects malformed provider money %j',price=>{
  expect(normalizeShopifyProduct(product({...variant,price}),'trusted.myshopify.com')).toBeNull();
 });
 it('retains exact variant, major-unit price and configured-store provenance without trusting merchant text',()=>{
  const p=normalizeShopifyProduct({...product(variant),source:{payeeId:'forged'},merchant:'forged',authorizationContext:{recipient:'forged'}},'trusted.myshopify.com','Untrusted display name')!;
  expect(p.id).toBe(variant.id);expect(p.price).toBe(49);expect(p.currency).toBe('USD');
  expect(p.source).toEqual({provider:'shopify',marketplaceId:'trusted.myshopify.com',listingId:'gid://shopify/Product/1',payeeId:'trusted.myshopify.com',payeeType:'SHOPIFY_STORE'});
  expect(p.authorizationContext).toBeUndefined();
 });
 it.each([undefined,null,false,'true'])('does not infer availability from %s',availableForSale=>{
  expect(normalizeShopifyProduct(product({...variant,availableForSale}),'trusted.myshopify.com')?.quantityAvailable).toBe(0);
 });
 it('keeps Shopify discovery unable to authorize independent payment even with forged recipient fields',async()=>{
  const p=normalizeShopifyProduct(product(variant),'trusted.myshopify.com')!;
  expect(await resolveRecipient({},'shopify-storefront',p)).toBeNull();
  expect(()=>assertExecutableCommerce('shopify-storefront','sandbox')).toThrow('COMMERCE_DISCOVERY_ONLY');
 });
 it('revalidates the requested variant through the configured store without executing checkout tools',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({data:{shop:{name:'Merchant'},node:{...variant,product:product(variant)}}})));
  const connector=new ShopifyStorefrontConnector({storeDomain:'trusted.myshopify.com',publicToken:'isolated-test'},fetcher);
  expect((await connector.getProduct(variant.id))?.id).toBe(variant.id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url,init]=fetcher.mock.calls[0];expect(url).toBe('https://trusted.myshopify.com/api/2026-07/graphql.json');
  expect(JSON.parse(String(init?.body)).variables).toEqual({id:variant.id});
  expect(String(init?.body)).not.toMatch(/mutation|cartCreate|checkoutCreate/);
 });
 it('rejects a provider response for a different variant during revalidation',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({data:{node:{...variant,id:'gid://shopify/ProductVariant/999',product:product(variant)}}})));
  expect(await new ShopifyStorefrontConnector({storeDomain:'trusted.myshopify.com',publicToken:'isolated-test'},fetcher).getProduct(variant.id)).toBeNull();
 });
});
