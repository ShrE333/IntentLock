import {beforeEach,describe,it,expect,vi} from 'vitest';
import {authorizeTransaction,verifyStoredAuthorization} from '../authorize/service';
import {signAuthorizationToken,sha256} from '../authorize/crypto';
import * as access from '../access/repository';
import * as auth from '../authorize/repository';
vi.mock('../access/repository',()=>({hasWalletPermission:vi.fn()}));
vi.mock('../authorize/repository',()=>({getAuthorizationById:vi.fn(),findAuthorizationByIdempotency:vi.fn()}));
const client={clientId:'client-a',name:'test',keyPrefix:'test',scopes:['authorize','verify'],status:'ACTIVE' as const};
const env={DATABASE_URL:'postgres://isolated.invalid/db',INTENTLOCK_AUTH_SIGNING_SECRET:'isolated-test-key'};
beforeEach(()=>vi.resetAllMocks());
const input={walletId:'wallet-b',ownerId:'client-a',userId:'client-a',idempotencyKey:'key',agentId:'agent',merchant:'test',transaction:{amount:49,currency:'USD',quantity:1,category:'electronics',brand:'Sony',features:[]}};
describe('external agent wallet delegation',()=>{
 it('rejects cross-client wallet authorization before disclosing old idempotent results',async()=>{
   vi.mocked(access.hasWalletPermission).mockResolvedValue(false);
   await expect(authorizeTransaction(env,client,input)).rejects.toThrow('WALLET_NOT_FOUND');
   expect(access.hasWalletPermission).toHaveBeenCalledWith(env.DATABASE_URL,'wallet-b','api:client-a','authorize');
   expect(auth.findAuthorizationByIdempotency).not.toHaveBeenCalled();
 });
 it('continues an authenticated integration only with a live explicit grant',async()=>{
   vi.mocked(access.hasWalletPermission).mockResolvedValue(true);
   vi.mocked(auth.findAuthorizationByIdempotency).mockResolvedValue({request_id:'r',decision:'STEP_UP',wallet_id:'wallet-b',agent_id:'agent',merchant:'test',quote_hash:'hash',remaining_authority:100,additional_authority_required:0,step_up_request_id:'step'} as any);
   expect((await authorizeTransaction(env,client,input)).decision).toBe('STEP_UP');
 });
 it('does not expose wallet facts to an authorize-only delegate without read permission',async()=>{
   vi.mocked(access.hasWalletPermission).mockImplementation(async(_db,_wallet,_principal,permission)=>permission==='authorize');
   await expect(authorizeTransaction(env,client,input)).rejects.toThrow('WALLET_NOT_FOUND');expect(auth.findAuthorizationByIdempotency).not.toHaveBeenCalled();
 });
 async function token(){const value=await signAuthorizationToken(env.INTENTLOCK_AUTH_SIGNING_SECRET,{type:'INTENTLOCK_AUTH_V1',authorizationId:'a',requestId:'r',clientId:client.clientId,agentId:'agent',walletId:'wallet-b',merchant:'test',quoteHash:'hash',amount:49,currency:'USD',decision:'ALLOW',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
 vi.mocked(auth.getAuthorizationById).mockResolvedValue({client_id:client.clientId,wallet_id:'wallet-b',request_id:'r',decision:'ALLOW',token_hash:await sha256(value),quote_hash:'hash'} as any);return value;}
 it('invalidates an otherwise valid authorization after wallet grant revocation',async()=>{
   const value=await token();vi.mocked(access.hasWalletPermission).mockResolvedValue(false);
   expect(await verifyStoredAuthorization(env,client,value)).toEqual({valid:false,reason:'WALLET_ACCESS_REVOKED'});
 });
 it('preserves existing token format and verification for an authorized client',async()=>{
   const value=await token();vi.mocked(access.hasWalletPermission).mockResolvedValue(true);
   expect((await verifyStoredAuthorization(env,client,value)).valid).toBe(true);
 });
});
