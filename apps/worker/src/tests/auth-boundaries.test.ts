import {beforeEach,describe,it,expect,vi} from 'vitest';
import {handleAuthorizeRoutes} from '../authorize/routes';
import {verifyStoredAuthorization} from '../authorize/service';
import {signAuthorizationToken} from '../authorize/crypto';
import * as repo from '../authorize/repository';
import {handleTrustCenterRoutes} from '../trust-center/routes';
vi.mock('../authorize/repository',()=>({findApiClientByHash:vi.fn(),getAuthorizationById:vi.fn()}));
const env={DATABASE_URL:'postgres://test.invalid/db',INTENTLOCK_AUTH_SIGNING_SECRET:'test-auth-key'};
const client={clientId:'client-a',name:'test',scopes:['authorize','verify'],status:'ACTIVE' as const,keyPrefix:'test'};
beforeEach(()=>{vi.resetAllMocks();});
describe('existing authenticated boundaries remain enforced',()=>{
 it('requires an API key and rejects invalid keys',async()=>{
   const url=new URL('https://worker.test/v1/authorize');
   expect((await handleAuthorizeRoutes(new Request(url,{method:'POST'}),env,url))?.status).toBe(401);
   vi.mocked(repo.findApiClientByHash).mockResolvedValue(null);
   expect((await handleAuthorizeRoutes(new Request(url,{method:'POST',headers:{authorization:'Bearer invalid'}}),env,url))?.status).toBe(401);
 });
 it('rejects clients without the necessary scope',async()=>{
   vi.mocked(repo.findApiClientByHash).mockResolvedValue({...client,scopes:['verify']});
   const url=new URL('https://worker.test/v1/authorize');
   expect((await handleAuthorizeRoutes(new Request(url,{method:'POST',headers:{authorization:'Bearer test'}}),env,url))?.status).toBe(403);
 });
 it('rejects a valid token presented by another client before reading its record',async()=>{
   const token=await signAuthorizationToken(env.INTENTLOCK_AUTH_SIGNING_SECRET,{type:'INTENTLOCK_AUTH_V1',authorizationId:'a',requestId:'r',clientId:client.clientId,agentId:'agent',walletId:'w',merchant:'test',quoteHash:'hash',amount:49,currency:'USD',decision:'ALLOW',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
   expect(await verifyStoredAuthorization(env,{...client,clientId:'client-b'},token)).toEqual({valid:false,reason:'CLIENT_MISMATCH'});
   expect(repo.getAuthorizationById).not.toHaveBeenCalled();
 });
 it('also rejects a stored record belonging to another client',async()=>{
   const token=await signAuthorizationToken(env.INTENTLOCK_AUTH_SIGNING_SECRET,{type:'INTENTLOCK_AUTH_V1',authorizationId:'a',requestId:'r',clientId:client.clientId,agentId:'agent',walletId:'w',merchant:'test',quoteHash:'hash',amount:49,currency:'USD',decision:'ALLOW',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
   vi.mocked(repo.getAuthorizationById).mockResolvedValue({client_id:'client-b'} as any);
   expect(await verifyStoredAuthorization(env,client,token)).toEqual({valid:false,reason:'CLIENT_MISMATCH'});
 });
 it('keeps TrustOps refund mutations protected without a token',async()=>{
   for(const path of ['/api/trust-center/refunds/request/s','/api/trust-center/refunds/r/sync']){
     const url=new URL('https://worker.test'+path);
     expect((await handleTrustCenterRoutes(new Request(url,{method:'POST'}),env,url))?.status).toBe(401);
   }
 });
});
