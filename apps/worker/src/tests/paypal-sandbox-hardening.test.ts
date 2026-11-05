import {describe,it,expect,vi} from 'vitest';
import {getPayPalAccessToken,getPayPalCaptureDetails,getPayPalRefundDetails,paypalBaseUrl} from '../session-payments/providers/paypal';
import {recipientMappingConfigured} from '../payments/recipient-binding';
import {syntheticEnv,syntheticMapping} from './recipient-fixtures';
const env={PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'unit-client',PAYPAL_CLIENT_SECRET:'unit-secret'};
describe('isolated mocked PayPal hardening regressions',()=>{
 it.each(['SANDBOX','LIVE','production',' sandbox '])('fails closed for invalid environment %s',value=>{
   expect(()=>paypalBaseUrl({PAYPAL_ENV:value})).toThrow('PAYPAL_ENVIRONMENT_INVALID');
 });
 it('does not echo provider-controlled OAuth descriptions',async()=>{
   const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error_description:'unit-secret credential-bearing diagnostics'}),{status:401}));
   await expect(getPayPalAccessToken(env,fetcher)).rejects.toThrow('PAYPAL_OAUTH_401:TOKEN_REQUEST_FAILED');
 });
 it.each([123,{},'   '])('rejects malformed successful OAuth tokens',async access_token=>{
   await expect(getPayPalAccessToken(env,vi.fn().mockResolvedValue(Response.json({access_token})))).rejects.toThrow('PAYPAL_OAUTH_INVALID_TOKEN');
 });
 it.each([undefined,'another-record'])('rejects missing or wrong provider read identity %s',async id=>{
   for(const read of [getPayPalCaptureDetails,getPayPalRefundDetails]){
     const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'unit-token'})).mockResolvedValueOnce(Response.json({id,status:'COMPLETED',amount:{value:'49',currency_code:'USD'}}));
     await expect(read(env,'expected-record',fetcher)).rejects.toThrow(/IDENTITY_MISMATCH/);
     expect(fetcher.mock.calls[1][1].method).toBe('GET');
   }
 });
 it('requires a resolvable demo catalog provider and seller for readiness',()=>{
   const configured=(patch:object)=>({...syntheticEnv,PAYPAL_MERCHANT_BINDINGS_JSON:JSON.stringify([{...syntheticMapping,catalogSellerId:'audiohub-sandbox',...patch}])});
   expect(recipientMappingConfigured(configured({}))).toBe(true);
   expect(recipientMappingConfigured(configured({catalogProvider:'wrong'}))).toBe(false);
   expect(recipientMappingConfigured(configured({catalogSellerId:'unknown'}))).toBe(false);
 });
});
