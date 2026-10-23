import {beforeEach,describe,it,expect,vi} from 'vitest';
import {secureFinancialRequest,accessRule} from '../access/gate';
import {ACCESS_CONTEXT,sha256,type Identity} from '../access/identity';
import * as repo from '../access/repository';
import {findApiClientByHash} from '../authorize/repository';
import {handleWalletRoutes} from '../wallets/routes';
import {createWallet} from '../wallets/repository';
vi.mock('../access/repository',()=>({rateLimit:vi.fn(),capabilityByHash:vi.fn(),createCapability:vi.fn(),rotateCapability:vi.fn(),revokeCapability:vi.fn(),claimNonce:vi.fn(),hasWalletPermission:vi.fn(),ownsIntent:vi.fn(),resourceWallet:vi.fn(),isDemoSession:vi.fn()}));
vi.mock('../authorize/repository',()=>({findApiClientByHash:vi.fn()}));
vi.mock('../wallets/repository',()=>({createWallet:vi.fn()}));
const env={DATABASE_URL:'postgres://isolated.invalid/db',DEMO_ACCESS_ENABLED:'true',PAYPAL_ENV:'sandbox'};
const tokens={a:'ildemo_'+'a'.repeat(64),b:'ildemo_'+'b'.repeat(64)};
let capabilities:Map<string,any>,nonces:Set<string>;
const next=vi.fn(async(_request:Request,e:any)=>new Response(JSON.stringify({principal:e[ACCESS_CONTEXT]?.principalId}),{headers:{'content-type':'application/json'}}));
beforeEach(async()=>{
 vi.resetAllMocks();nonces=new Set();capabilities=new Map();
 for(const key of ['a','b'] as const)capabilities.set(await sha256(tokens[key]),{principal_id:'demo:'+key,expires_at:new Date(Date.now()+600000).toISOString()});
 vi.mocked(repo.rateLimit).mockResolvedValue(true);
 vi.mocked(repo.capabilityByHash).mockImplementation(async(_db,hash)=>capabilities.get(hash)??null);
 vi.mocked(repo.createCapability).mockImplementation(async(_db,hash,principal,expires)=>{capabilities.set(hash,{principal_id:principal,expires_at:expires});});
 vi.mocked(repo.rotateCapability).mockImplementation(async(_db,oldHash,newHash,expires)=>{const current=capabilities.get(oldHash);if(!current)return false;capabilities.delete(oldHash);capabilities.set(newHash,{...current,expires_at:expires});return true;});
 vi.mocked(repo.revokeCapability).mockImplementation(async(_db,hash)=>{capabilities.delete(hash);});
 vi.mocked(repo.claimNonce).mockImplementation(async(_db,principal,id)=>{const key=principal+':'+id;if(nonces.has(key))return false;nonces.add(key);return true;});
 vi.mocked(repo.hasWalletPermission).mockImplementation(async(_db,wallet,principal)=>wallet==='wallet-a'&&principal==='demo:a'||wallet==='wallet-b'&&principal==='demo:b');
 vi.mocked(repo.ownsIntent).mockImplementation(async(_db,id,principal)=>id==='intent-a'&&principal==='demo:a');
 vi.mocked(repo.resourceWallet).mockImplementation(async(_db,_kind,id)=>id==='session-a'||id==='refund-a'?'wallet-a':id==='session-b'||id==='refund-b'?'wallet-b':null);
 vi.mocked(repo.isDemoSession).mockResolvedValue(true);
 next.mockImplementation(async(_r,e:any)=>new Response(JSON.stringify({principal:e[ACCESS_CONTEXT]?.principalId})));
});
function request(path:string,token:string|null=tokens.a,body?:unknown,nonce=crypto.randomUUID()){
 const headers:Record<string,string>={'cf-connecting-ip':'192.0.2.1'};if(token)headers.authorization='Bearer '+token;
 if(body!==undefined){headers['content-type']='application/json';headers['x-intentlock-request-id']=nonce;}
 return new Request('https://worker.test'+path,{method:body!==undefined?'POST':'GET',headers,body:body===undefined?undefined:JSON.stringify(body)});
}
const call=(r:Request,e=env)=>secureFinancialRequest(r,e,next);
describe('financial HTTP ownership boundary',()=>{
 it.each(['/api/wallets','/api/sessions','/api/sessions/session-a/proof','/api/audit/session-a','/api/trust-center/overview'])('requires authentication for %s',async path=>{
   expect((await call(request(path,null))).status).toBe(401);expect(next).not.toHaveBeenCalled();
 });
 const crossReads=['/api/sessions/session-b','/api/sessions/session-b/payment','/api/sessions/session-b/proof','/api/risk/session/session-b','/api/risk/wallet/wallet-b/summary','/api/audit/session-b','/api/trust-center/disputes/evidence/session-b','/api/trust-center/post-purchase/session-b','/api/trust-center/disputes/paypal/session/session-b'];
 it.each(crossReads)('does not disclose another visitor through %s',async path=>{expect((await call(request(path))).status).toBe(404);expect(next).not.toHaveBeenCalled();});
 it.each(['/api/wallets/wallet-b/evaluate','/api/wallets/wallet-b/step-up/su/resolve','/api/sessions/session-b/run','/api/sessions/session-b/payment','/api/sessions/session-b/payment/authorize','/api/sessions/session-b/payment/capture','/api/sessions/session-b/step-up/resolve','/api/trust-center/refunds/evaluate/session-b'])('blocks cross-principal mutation %s',async path=>{
   expect((await call(request(path,tokens.a,{action:'ALLOW_ONCE',amount:49,quantity:1}))).status).toBe(404);expect(next).not.toHaveBeenCalled();
 });
 it('checks body wallet IDs instead of forged owner fields',async()=>{
   expect((await call(request('/api/sessions',tokens.a,{walletId:'wallet-b',ownerId:'demo:a',userId:'demo:a',connectorId:'paypal-demo-marketplace'}))).status).toBe(404);
   expect(next).not.toHaveBeenCalled();
 });
 it('atomically assigns new wallet ownership from server context, ignoring forged identity',async()=>{
   vi.mocked(createWallet).mockResolvedValue({walletId:'created'} as any);
   const body={ownerId:'demo:b',principalId:'ops:trustops',userId:'admin',name:'test',currency:'USD',countryCode:'US',totalAuthority:100,autoBuyLimit:55,maxSingleTransaction:75,validUntil:new Date(Date.now()+3600000).toISOString()};
   const response=await secureFinancialRequest(request('/api/wallets',tokens.a,body),env,(r,e)=>handleWalletRoutes(r,e,new URL(r.url)) as Promise<Response>);
   expect(response.status).toBe(201);expect(createWallet).toHaveBeenCalledWith(env.DATABASE_URL,expect.not.objectContaining({ownerId:'demo:b'}),'demo:a');
 });
 it('permits the owner and presents the same 404 for absent and foreign resources',async()=>{
   expect((await call(request('/api/sessions/session-a'))).status).toBe(200);
   const missing=await call(request('/api/sessions/missing'));const foreign=await call(request('/api/sessions/session-b'));
   expect(missing.status).toBe(404);expect(await missing.text()).toBe(await foreign.text());
 });
 it('checks a nested STEP-UP request belongs to the owned wallet without disclosing another request',async()=>{
   const response=await call(request('/api/wallets/wallet-a/step-up/refund-b/resolve',tokens.a,{action:'ALLOW_ONCE'}));
   expect(response.status).toBe(404);expect(next).not.toHaveBeenCalled();
 });
 it.each(['/api/trust-center/payees','/api/trust-center/disputes/paypal/provider-dispute'])('denies privileged reads %s',async path=>expect((await call(request(path))).status).toBe(403));
 it.each(['/api/trust-center/refunds/request/session-a','/api/trust-center/refunds/refund-a/sync','/api/trust-center/reconciliation/session-a/reconcile','/api/trust-center/disputes/paypal/d/send-summary','/api/payments/create-link'])('denies demo privilege escalation %s',async path=>{
   expect((await call(request(path,tokens.a,{ownerId:'ops',admin:true,scopes:['*']}))).status).toBe(403);expect(next).not.toHaveBeenCalled();
 });
 it('does not use a forged administrative header as an identity',async()=>{
   const r=request('/api/wallets');r.headers.set('x-intentlock-ops-token','forged');expect((await call(r)).status).toBe(401);
 });
 it('requires client scopes even when a wallet grant exists',async()=>{
   vi.mocked(findApiClientByHash).mockResolvedValue({clientId:'c',status:'ACTIVE',scopes:['authorize'],name:'test',keyPrefix:'test'});
   vi.mocked(repo.hasWalletPermission).mockResolvedValue(true);
   expect((await call(request('/api/sessions/session-a/payment','test-client-key',{}))).status).toBe(403);
 });
 it('requires read permission when a delegated mutation would return financial details',async()=>{
   vi.mocked(findApiClientByHash).mockResolvedValue({clientId:'c',status:'ACTIVE',scopes:['payment:execute'],name:'test',keyPrefix:'test'});
   vi.mocked(repo.hasWalletPermission).mockImplementation(async(_db,_wallet,_principal,permission)=>permission==='execute');
   expect((await call(request('/api/sessions/session-a/payment','test-client-key',{}))).status).toBe(404);expect(next).not.toHaveBeenCalled();
 });
 it('refuses external connectors and non-web channel creation for demos',async()=>{
   for(const patch of [{connectorId:'ebay-browse'},{connectorId:'shopify-storefront'},{connectorId:'paypal-demo-marketplace',channel:'WHATSAPP'}])expect((await call(request('/api/sessions',tokens.a,{walletId:'wallet-a',...patch}))).status).toBe(403);
 });
 it('refuses a non-demo session even if wallet ownership matches',async()=>{
   vi.mocked(repo.isDemoSession).mockResolvedValue(false);expect((await call(request('/api/sessions/session-a/payment',tokens.a,{}))).status).toBe(403);
 });
 it('caps demo authority and fails closed outside sandbox',async()=>{
   expect((await call(request('/api/wallets',tokens.a,{currency:'USD',totalAuthority:10000}))).status).toBe(403);
   expect((await call(request('/api/wallets'),{...env,PAYPAL_ENV:'live'})).status).toBe(403);
 });
 it('returns 404 for unclassified routes without touching the database',async()=>{
   expect((await secureFinancialRequest(new Request('https://worker.test/api/admin/unknown',{method:'POST'}),{},next)).status).toBe(404);
   expect(repo.rateLimit).not.toHaveBeenCalled();
 });
});
describe('capability lifetime, replay and abuse controls',()=>{
 it('issues distinct principals and unguessable capabilities for anonymous visitors',async()=>{
   const a=await (await call(request('/api/access/demo',null,{}))).json() as any;
   const b=await (await call(request('/api/access/demo',null,{ownerId:'demo:a'}))).json() as any;
   expect(a.token).toMatch(/^ildemo_[a-f0-9]{64}$/);expect(a.token).not.toBe(b.token);expect(a.scopes).not.toContain('*');
   const pa=capabilities.get(await sha256(a.token)).principal_id,pb=capabilities.get(await sha256(b.token)).principal_id;
   expect(pa).not.toBe(pb);expect(pa).not.toBe('demo:a');expect(Date.parse(a.expiresAt)-Date.now()).toBeLessThanOrEqual(1800000);
   expect(JSON.stringify(a)).not.toContain('principal_id');
 });
 it('rejects expired, unknown and revoked capabilities',async()=>{
   capabilities.get(await sha256(tokens.a)).expires_at='2000-01-01T00:00:00Z';expect((await call(request('/api/wallets'))).status).toBe(401);
   expect((await call(request('/api/wallets','ildemo_'+'c'.repeat(64)))).status).toBe(401);
   capabilities.delete(await sha256(tokens.b));expect((await call(request('/api/wallets',tokens.b))).status).toBe(401);
 });
 it('rotates once, revokes old capability replay, and preserves resource identity',async()=>{
   const rotated=await (await call(request('/api/access/refresh',tokens.a,{}))).json() as any;
   expect((await call(request('/api/access/refresh',tokens.a,{}))).status).toBe(401);
   expect((await call(request('/api/sessions/session-a',rotated.token))).status).toBe(200);
 });
 it('logs out server-side',async()=>{
   expect((await call(request('/api/access/logout',tokens.a,{}))).status).toBe(200);
   expect((await call(request('/api/wallets'))).status).toBe(401);
 });
 it('rejects mutation replay before executing a financial handler twice',async()=>{
   const id=crypto.randomUUID();const a=await call(request('/api/sessions/session-a/run',tokens.a,{},id));const b=await call(request('/api/sessions/session-a/run',tokens.a,{},id));
   expect(a.status).toBe(200);expect(b.status).toBe(409);expect(next).toHaveBeenCalledOnce();
 });
 it('enforces issuance/request rate limits and bounded request bodies',async()=>{
   vi.mocked(repo.rateLimit).mockResolvedValue(false);expect((await call(request('/api/access/demo',null,{}))).status).toBe(429);
   expect(repo.createCapability).not.toHaveBeenCalled();vi.mocked(repo.rateLimit).mockResolvedValue(true);
   expect((await call(request('/api/sessions',tokens.a,{walletId:'wallet-a',data:'x'.repeat(17000)}))).status).toBe(413);
 });
 it('fails closed if ownership storage is unavailable',async()=>{
   vi.mocked(repo.hasWalletPermission).mockRejectedValue(new Error('storage unavailable'));
   expect((await call(request('/api/sessions/session-a'))).status).toBe(503);expect(next).not.toHaveBeenCalled();
 });
 it('leaves signature verification to provider ingress, without assigning a browser principal',async()=>{
   next.mockImplementation(async(_r,e:any)=>{expect(e[ACCESS_CONTEXT]).toBeUndefined();return new Response('invalid provider signature',{status:401});});
   for(const path of ['/webhooks/paypal','/webhooks/razorpay','/webhooks/waha'])expect((await call(request(path,null,{sessionId:'session-b'}))).status).toBe(401);
   expect(repo.capabilityByHash).not.toHaveBeenCalled();
 });
});
