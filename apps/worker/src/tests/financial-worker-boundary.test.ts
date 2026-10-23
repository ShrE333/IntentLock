import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('agents',()=>({routeAgentRequest:vi.fn().mockResolvedValue(null)}));
vi.mock('../agent/purchase-agent',()=>({PurchaseAgent:class {}}));
vi.mock('../access/repository',()=>({rateLimit:vi.fn(async()=>true),capabilityByHash:vi.fn(),hasWalletPermission:vi.fn(),resourceWallet:vi.fn(),isDemoSession:vi.fn(async()=>true)}));
vi.mock('../wallets/repository',()=>({listWallets:vi.fn(),getWallet:vi.fn()}));
vi.mock('../sessions/repository',()=>({getSession:vi.fn()}));
vi.mock('../session-payments/providers/paypal',async original=>({...await original<typeof import('../session-payments/providers/paypal')>(),verifyPayPalWebhook:vi.fn()}));
import worker from '../index';
import * as access from '../access/repository';
import {listWallets} from '../wallets/repository';
import {getSession} from '../sessions/repository';
import {verifyPayPalWebhook} from '../session-payments/providers/paypal';
const env={DATABASE_URL:'postgres://isolated.invalid/db',DEMO_ACCESS_ENABLED:'true',PAYPAL_ENV:'sandbox',CORS_ALLOWED_ORIGINS:'https://app.test'} as any;
const token='ildemo_'+'a'.repeat(64);
beforeEach(()=>{vi.clearAllMocks();vi.mocked(access.capabilityByHash).mockResolvedValue({principal_id:'demo:a',expires_at:new Date(Date.now()+600000).toISOString()});vi.mocked(access.resourceWallet).mockResolvedValue('wallet-b');vi.mocked(access.hasWalletPermission).mockResolvedValue(false);vi.mocked(listWallets).mockResolvedValue([]);});
describe('actual exported Worker financial boundary',()=>{
 it('protects anonymous reads and returns browser-readable authentication errors',async()=>{
   const response=await worker.fetch(new Request('https://worker.test/api/wallets',{headers:{origin:'https://app.test'}}),env);
   expect(response.status).toBe(401);expect(response.headers.get('access-control-allow-origin')).toBe('https://app.test');expect(listWallets).not.toHaveBeenCalled();
 });
 it('passes only verified identity to tenant-filtered list queries',async()=>{
   const response=await worker.fetch(new Request('https://worker.test/api/wallets?userId=demo:b',{headers:{authorization:'Bearer '+token,'x-owner-id':'demo:b'}}),env);
   expect(response.status).toBe(200);expect(listWallets).toHaveBeenCalledWith(env.DATABASE_URL,'demo:a');expect(response.headers.get('cache-control')).toBe('no-store');
 });
 it('denies cross-user session access before loading sensitive session details',async()=>{
   const response=await worker.fetch(new Request('https://worker.test/api/sessions/session-b',{headers:{authorization:'Bearer '+token}}),env);
   expect(response.status).toBe(404);expect(getSession).not.toHaveBeenCalled();
 });
 it.each(['payment','payment/authorize','payment/capture'])('rejects cross-user %s before financial execution',async path=>{
   const response=await worker.fetch(new Request('https://worker.test/api/sessions/session-b/'+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-intentlock-request-id':'isolated-request-123'},body:JSON.stringify({walletId:'wallet-a',ownerId:'demo:b',reservationState:'RESERVED',expectedRecipient:{paypalMerchantId:'forged-payee'},merchantMappingTrusted:true})}),env);
   expect(response.status).toBe(404);expect(getSession).not.toHaveBeenCalled();
 });
 it('requires independent PayPal webhook authenticity even without browser access',async()=>{
   vi.mocked(verifyPayPalWebhook).mockResolvedValue({valid:false,verificationStatus:'FAILURE',event:{}});
   const request=new Request('https://worker.test/webhooks/paypal',{method:'POST',body:'{"event_type":"PAYMENT.CAPTURE.COMPLETED"}'});
   const response=await worker.fetch(request,env);expect(response.status).toBe(401);expect(verifyPayPalWebhook).toHaveBeenCalledOnce();expect(access.capabilityByHash).not.toHaveBeenCalled();
 });
 it('keeps CORS separate from endpoint authentication',async()=>{
   const preflight=await worker.fetch(new Request('https://worker.test/api/wallets',{method:'OPTIONS',headers:{origin:'https://app.test','access-control-request-method':'GET','access-control-request-headers':'authorization'}}),env);
   expect(preflight.status).toBe(204);
   expect((await worker.fetch(new Request('https://worker.test/api/wallets',{headers:{origin:'https://app.test'}}),env)).status).toBe(401);
 });
});
