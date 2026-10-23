import {describe,it,expect} from 'vitest';
import {globalPreflightResponse,originAllowed,applyCors} from '../http/cors';
import {WalletCreateSchema,WalletTransactionSchema} from '../wallets/validation';
import {resolveApiUrl,refreshWithError} from '../../../web/app/runtime-config';
import {demoStages,demoWindowExpired,sandboxServicesReady} from '../../../web/app/demo-evidence';
import {PayPalDemoMarketplaceConnector} from '../commerce/paypal-demo-connector';
import {paymentEnv,orchestrationEnv} from '../queue/purchase-jobs';
import {buildOrchestratorEnv} from '../sessions/routes';
import {evaluateWalletTransaction} from '../wallets/policy';
import {authorizeProductContext} from '../payments/authorization-context';

describe('CORS authenticated browser contract',()=>{
 const env={CORS_ALLOWED_ORIGINS:'https://app.test,https://ops.test'};
 const req=(origin:string,headers='authorization,x-intentlock-key')=>new Request('https://worker.test/v1/authorize',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':headers}});
 it('allows configured origins and credential headers without enabling cookies',()=>{
   const r=globalPreflightResponse(req('https://app.test'),env);
   expect(r.status).toBe(204);expect(r.headers.get('access-control-allow-origin')).toBe('https://app.test');expect(r.headers.has('access-control-allow-credentials')).toBe(false);
 });
 it('rejects unlisted origins for preflight and actual requests',()=>{
   const request=req('https://evil.test');expect(globalPreflightResponse(request,env).status).toBe(403);expect(originAllowed(request,env)).toBe(false);
   expect(applyCors(request,new Response('private'),env).status).toBe(403);
 });
 it('rejects unknown requested headers and methods',()=>{
   expect(globalPreflightResponse(req('https://app.test','x-untrusted-header'),env).status).toBe(403);
   expect(globalPreflightResponse(new Request('https://worker.test',{method:'OPTIONS',headers:{origin:'https://app.test','access-control-request-method':'DELETE'}}),env).status).toBe(403);
 });
 it('keeps endpoint authentication status and correct origin on actual responses',()=>{
   const r=applyCors(req('https://app.test'),new Response('unauthorized',{status:401,headers:{'access-control-allow-origin':'*'}}),env);
   expect(r.status).toBe(401);expect(r.headers.get('access-control-allow-origin')).toBe('https://app.test');
 });
});
describe('financial API schemas',()=>{
 const tx={amount:49,currency:'USD',quantity:1,category:'electronics',brand:'Sony',features:[]};
 it.each(['49','1e2','0x31','',null,NaN,Infinity,-1,0,1.001])('rejects malformed amount %s',amount=>expect(WalletTransactionSchema.safeParse({...tx,amount}).success).toBe(false));
 it.each(['XYZ','usd','','US',null])('rejects invalid currency %s',currency=>expect(WalletTransactionSchema.safeParse({...tx,currency}).success).toBe(false));
 it('rejects malformed wallet limits and expiry before persistence',()=>{
   const w={name:'test',currency:'USD',totalAuthority:100,autoBuyLimit:55,maxSingleTransaction:75,validUntil:'2099-01-01T00:00:00.000Z'};
   expect(WalletCreateSchema.safeParse(w).success).toBe(true);
   for(const patch of [{autoBuyLimit:'55'},{totalAuthority:Infinity},{maxSingleTransaction:101},{validUntil:'invalid'}])expect(WalletCreateSchema.safeParse({...w,...patch}).success).toBe(false);
 });
});
describe('frontend runtime honesty',()=>{
 it('handles refresh/poll rejection without leaking an unhandled promise',async()=>{
   const errors:unknown[]=[];await expect(refreshWithError(async()=>{throw new Error('service unavailable');},e=>errors.push(e))).resolves.toBeUndefined();
   expect((errors[0] as Error).message).toBe('service unavailable');
 });
 it('disables expired/invalid WhatsApp demo windows and unavailable sandbox services',()=>{
   expect(demoWindowExpired('2026-10-05',Date.parse('2026-10-22T00:00:00Z'))).toBe(true);
   expect(demoWindowExpired('invalid')).toBe(true);expect(demoWindowExpired('2026-02-30')).toBe(true);
   expect(demoWindowExpired('2099-01-01',Date.parse('2026-10-22T00:00:00Z'))).toBe(false);
   expect(sandboxServicesReady({paypalConfigured:false,paypalEnvironment:'sandbox'})).toBe(false);
   expect(sandboxServicesReady({paypalConfigured:true,paypalEnvironment:'live'})).toBe(false);
   expect(sandboxServicesReady({paypalConfigured:true})).toBe(false);
   expect(sandboxServicesReady({paypalConfigured:true,paypalEnvironment:'sandbox'})).toBe(false);
   expect(sandboxServicesReady({paypalConfigured:true,paypalEnvironment:'sandbox',recipientMappingConfigured:true})).toBe(true);
 });
 it('never falls back to localhost in production',()=>{expect(()=>resolveApiUrl(undefined,true)).toThrow('not configured');expect(resolveApiUrl(undefined,false)).toBe('http://localhost:8787');expect(()=>resolveApiUrl('http://api.test',true)).toThrow('HTTPS');});
 it('does not mark payment or proof complete merely because a session exists',()=>{
   expect(demoStages({selectedDecision:'BLOCK'},[])).toEqual([true,true,false,false,false]);
   expect(demoStages({selectedDecision:'ALLOW'},[{eventType:'PAYPAL_AUTHORIZED'}])[3]).toBe(false);
   expect(demoStages({},[{eventType:'PAYPAL_AUTHORIZED'},{eventType:'PAYPAL_CAPTURE_REQUESTED'}],false)[4]).toBe(false);
 });
 it.each([['Sony WH-CH720N wireless ANC headphones','Sony','ALLOW'],['Bose QuietComfort wireless ANC headphones','Bose','STEP_UP'],['Boat Nirvana ANC wireless headphones','Boat','BLOCK']])('evaluates %s without substituting another brand',async(query,brand,decision)=>{
   const wallet={walletId:'w',name:'test',currency:'USD',countryCode:'US',totalAuthority:100,spentAmount:0,autoBuyLimit:55,maxSingleTransaction:75,allowedCategories:['electronics'],allowedBrands:['Sony','Bose'],blockedBrands:['Boat'],requiredFeatures:['wireless','ANC'],status:'ACTIVE' as const,validUntil:'2099-01-01T00:00:00.000Z'};
   const products=await new PayPalDemoMarketplaceConnector().search({query,limit:12});
   expect(products.length).toBeGreaterThan(0);expect(products.every(p=>p.brand===brand)).toBe(true);
   const evaluations=await Promise.all(products.map(async p=>evaluateWalletTransaction(wallet,(await authorizeProductContext({FX_PROVIDER:'static'},wallet,p)).transaction)));
   expect(evaluations[0].decision).toBe(decision);
 });
});
describe('effective queue and web environment',()=>{
 it('preserves all effective policy and payment configuration',()=>{
   const env={DATABASE_URL:'postgres://test.invalid/db',PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'test-id',PAYPAL_CLIENT_SECRET:'test-only',PAYPAL_WEBHOOK_ID:'test-webhook',EBAY_CLIENT_ID:'test-ebay',EBAY_CLIENT_SECRET:'test-only',FX_PROVIDER:'disabled',FX_RATES_JSON:'{}',PAYEELOCK_MODE:'enforce',PAYEELOCK_TRUSTED_PAYEES_JSON:'[]',FUTURE_CONFIGURATION:'retained'};
   expect(paymentEnv(env)).toEqual(env);expect(orchestrationEnv(env)).toEqual(buildOrchestratorEnv(env));
 });
});
