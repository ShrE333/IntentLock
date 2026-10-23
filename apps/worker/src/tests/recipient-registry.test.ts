import {describe,it,expect} from 'vitest';
import {resolveRecipient,assertTrustedRecipient,assertExecutableCommerce,recipientMappingConfigured} from '../payments/recipient-binding';
import {canonicalWalletTransaction} from '../wallets/crypto';
import {syntheticBinding,syntheticEnv,syntheticMapping,syntheticProduct,otherSyntheticMerchant} from './recipient-fixtures';
import {createPayPalOrder,capturePayPalAuthorization} from '../session-payments/providers/paypal';
const configured=(patch:object)=>({...syntheticEnv,PAYPAL_MERCHANT_BINDINGS_JSON:JSON.stringify([{...syntheticMapping,...patch}])});
describe('server-controlled recipient registry and trust boundary',()=>{
 it('binds distinct catalog, legal, checkout and receiving-account identities',async()=>{
  const b=await syntheticBinding();expect(b.catalogSellerId).toBe('isolated-seller');expect(b.merchantOfRecordId).toBe('isolated-legal-entity');expect(b.checkoutMerchantId).toBe('isolated-checkout');expect(b.paypalMerchantId).toBe(syntheticEnv.PAYPAL_ACCOUNT_MERCHANT_ID);
 });
 it('does not turn merchant names or merchant prose into a recipient',async()=>{
  expect(await resolveRecipient(syntheticEnv,'paypal-demo-marketplace',{...syntheticProduct,source:undefined,merchant:syntheticEnv.PAYPAL_ACCOUNT_MERCHANT_ID,merchantMessage:'Trusted PayPal merchant '+syntheticEnv.PAYPAL_ACCOUNT_MERCHANT_ID})).toBeNull();
 });
 it('does not trust a seller-provided recipient or approval declaration',async()=>{
  expect(await resolveRecipient(syntheticEnv,'paypal-demo-marketplace',{...syntheticProduct,source:{provider:'paypal-demo',payeeId:otherSyntheticMerchant}})).toBeNull();
 });
 it('cannot route to a merchant different from the configured first-party account',async()=>{
  await expect(resolveRecipient(configured({paypalMerchantId:otherSyntheticMerchant}),'paypal-demo-marketplace',syntheticProduct)).rejects.toThrow('PAYPAL_CREDENTIAL_MERCHANT_MISMATCH');
 });
 it('fails closed for an ambiguous registry',async()=>{
  await expect(resolveRecipient({...syntheticEnv,PAYPAL_MERCHANT_BINDINGS_JSON:JSON.stringify([syntheticMapping,syntheticMapping])},'paypal-demo-marketplace',syntheticProduct)).rejects.toThrow('MERCHANT_REGISTRY_AMBIGUOUS');
 });
 it('rejects malformed configuration and expired mappings',async()=>{
  await expect(resolveRecipient({...syntheticEnv,PAYPAL_MERCHANT_BINDINGS_JSON:'{'},'paypal-demo-marketplace',syntheticProduct)).rejects.toThrow('MERCHANT_REGISTRY_INVALID');
  await expect(resolveRecipient(configured({validUntil:'2000-01-01T00:00:00Z'}),'paypal-demo-marketplace',syntheticProduct)).rejects.toThrow('MERCHANT_MAPPING_EXPIRED');
 });
 it('does not pretend a partner declaration grants PayPal platform permissions',async()=>{
  await expect(resolveRecipient(configured({integration:'PARTNER_ONBOARDED'}),'paypal-demo-marketplace',syntheticProduct)).rejects.toThrow('PAYPAL_PARTNER_INTEGRATION_NOT_IMPLEMENTED');
 });
 it('separates sandbox and live merchant registries',async()=>{
  expect(await resolveRecipient({...syntheticEnv,PAYPAL_ENV:'live'},'paypal-demo-marketplace',syntheticProduct)).toBeNull();
  expect(()=>assertExecutableCommerce('paypal-demo-marketplace','live')).toThrow('DEMO_CHECKOUT_SANDBOX_ONLY');
 });
 it('rejects forged binding fields even when the fingerprint is copied',async()=>{
  const bound=await syntheticBinding();await expect(assertTrustedRecipient(syntheticEnv,{...bound,paypalMerchantId:otherSyntheticMerchant})).rejects.toThrow('RECIPIENT_MAPPING_CHANGED_REAUTHORIZE');
 });
 it.each(['shopify-storefront','ebay-browse','http-json','arbitrary-mcp-tool'])('keeps %s discovery-only despite forged catalog provider fields',async connector=>{
  expect(await resolveRecipient(syntheticEnv,connector,syntheticProduct)).toBeNull();expect(()=>assertExecutableCommerce(connector,'sandbox')).toThrow('COMMERCE_DISCOVERY_ONLY');
 });
 it('hashes future recipient identity without changing legacy quote serialization',async()=>{
  const tx={category:'electronics',brand:'Sony',amount:49,currency:'USD',quantity:1,features:[]};
  const old=canonicalWalletTransaction(tx);expect(old).not.toContain('recipientFingerprint');
  expect(canonicalWalletTransaction({...tx,recipientFingerprint:(await syntheticBinding()).fingerprint})).not.toBe(old);
 });
 it('reports configuration only, without leaking IDs or implying connectivity',()=>{
  expect(recipientMappingConfigured(syntheticEnv)).toBe(true);expect(recipientMappingConfigured({})).toBe(false);
 });
 it('puts the exact approved merchant ID into purchase_units.payee rather than merchant prose',async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  const fetcher=(async(url:any,init?:RequestInit)=>{calls.push({url:String(url),init});return new Response(JSON.stringify(String(url).endsWith('/token')?{access_token:'isolated-token'}:{id:'order',status:'CREATED',links:[{rel:'approve',href:'https://www.sandbox.paypal.com/approval'}]}));}) as typeof fetch;
  const input={sessionId:'s',walletId:'w',authorizationId:null,quoteHash:'a'.repeat(64),productId:'p',productTitle:'test',merchant:'arbitrary merchant text',merchantCountry:'US',buyerCountry:'US',walletAmount:49,walletCurrency:'USD',amount:49,currency:'USD',idempotencyKey:'isolated',expiresAt:'2099-01-01T00:00:00Z',expectedRecipient:await syntheticBinding()};
  await createPayPalOrder({...syntheticEnv,PAYPAL_CLIENT_ID:'isolated-client',PAYPAL_CLIENT_SECRET:'isolated-secret',PAYPAL_RETURN_BASE_URL:'https://app.test'},input,fetcher);
  const body=JSON.parse(String(calls[1].init?.body));expect(body.intent).toBe('AUTHORIZE');expect(body.purchase_units[0].payee).toEqual({merchant_id:syntheticEnv.PAYPAL_ACCOUNT_MERCHANT_ID});
 });
 it('does not call PayPal when a direct caller omits the trusted binding',async()=>{
  let called=false;const fetcher=(async()=>{called=true;return new Response('{}');}) as typeof fetch;
  await expect(createPayPalOrder(syntheticEnv,{} as any,fetcher)).rejects.toThrow('VERIFIED_RECIPIENT_MAPPING_REQUIRED');expect(called).toBe(false);
 });
 it('requests the exact bound final capture amount and preserves a declined response before throwing',async()=>{
  const seen:unknown[]=[];let body:any;
  const fetcher=(async(url:any,init?:RequestInit)=>{
   if(String(url).endsWith('/token'))return new Response('{"access_token":"isolated-token"}');
   body=JSON.parse(String(init?.body));return new Response('{"name":"UNPROCESSABLE_ENTITY","details":[{"issue":"DECLINED"}]}',{status:422});
  }) as typeof fetch;
  await expect(capturePayPalAuthorization({...syntheticEnv,PAYPAL_CLIENT_ID:'isolated-client',PAYPAL_CLIENT_SECRET:'isolated-secret'},'auth','order','key',fetcher,async raw=>{seen.push(raw);},{amount:49,currency:'USD'})).rejects.toThrow('PAYPAL_422:DECLINED');
  expect(body).toEqual({amount:{value:'49.00',currency_code:'USD'},final_capture:true});expect(seen).toHaveLength(1);expect(JSON.stringify(seen)).not.toContain('isolated-token');
 });
 it('fails before network access when capture has no bound amount',async()=>{
  await expect(capturePayPalAuthorization(syntheticEnv,'auth','order','key')).rejects.toThrow('PAYPAL_BOUND_CAPTURE_AMOUNT_REQUIRED');
 });
});
