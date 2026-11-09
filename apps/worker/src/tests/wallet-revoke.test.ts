import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {isolatedDatabase,type IsolatedDatabase} from './isolated-database';
import {readFileSync} from 'node:fs';
import {secureFinancialRequest,accessRule} from '../access/gate';
import {sha256} from '../access/identity';
import {handleWalletRoutes} from '../wallets/routes';
import {reserveWalletAuthority,beginProviderOperation,confirmProviderOperation} from '../session-payments/reservations';
import {applyWalletSpendOnce} from '../session-payments/repository';
import {findApiClientByHash} from '../authorize/repository';
let db:IsolatedDatabase;
vi.mock('@neondatabase/serverless',()=>({neon:()=>{
 const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{let query=parts[0];for(let i=0;i<values.length;i++)query+='$'+(i+1)+parts[i+1];return (await db.query(query,values)).rows;};
 sql.query=async(query:string,values:unknown[])=> (await db.query(query,values)).rows;return sql;
}}));
vi.mock('../access/repository',async importOriginal=>({...await importOriginal<typeof import('../access/repository')>(),rateLimit:vi.fn(),capabilityByHash:vi.fn(),claimNonce:vi.fn(),isDemoSession:vi.fn()}));
vi.mock('../authorize/repository',()=>({findApiClientByHash:vi.fn()}));
vi.mock('../session-payments/providers/paypal',()=>({getPayPalReservationTruth:vi.fn()}));
vi.mock('../session-payments/audit',()=>({appendSessionAuditEvent:vi.fn()}));
import * as repo from '../access/repository';
const env={DATABASE_URL:'isolated',DEMO_ACCESS_ENABLED:'true',PAYPAL_ENV:'sandbox'};
const tokens={a:'ildemo_'+'a'.repeat(64),b:'ildemo_'+'b'.repeat(64)};
const quote='a'.repeat(64);
const route=(r:Request,e:any)=>handleWalletRoutes(r,e,new URL(r.url)) as Promise<Response>;
const post=(wallet:string,token:string|null=tokens.a,body:unknown={})=>new Request(`https://worker.test/api/wallets/${wallet}/revoke`,{method:'POST',headers:{'cf-connecting-ip':'192.0.2.1','content-type':'application/json','x-intentlock-request-id':crypto.randomUUID(),...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
const call=(r:Request)=>secureFinancialRequest(r,env,route);
const status=async(w='w')=>(await db.query<any>('SELECT status FROM intent_wallets WHERE wallet_id=$1',[w])).rows[0]?.status;
async function session(id:string,amount=70){
 await db.query(`INSERT INTO purchase_sessions(session_id,wallet_id,user_prompt,status,selected_product,selected_decision) VALUES($1,'w','test','READY_TO_PAY',$2::jsonb,'ALLOW')`,[id,JSON.stringify({id:'p',price:amount,currency:'USD'})]);
}
const reserve=(s='s1')=>reserveWalletAuthority('isolated',{sessionId:s,walletId:'w',quoteHash:quote,idempotencyKey:'key-'+s,amount:70,currency:'USD',provider:'paypal'});
async function authorized(s='s1'){
 await beginProviderOperation('isolated',s,quote,'CHECKOUT');await confirmProviderOperation('isolated',s,'CHECKOUT','order-'+s);
 await db.query(`INSERT INTO session_payment_links(session_id,wallet_id,quote_hash,idempotency_key,provider,provider_order_id,amount,currency) SELECT session_id,wallet_id,quote_hash,operation_key,provider,provider_order_id,amount,currency FROM wallet_authority_reservations WHERE session_id=$1`,[s]);
 await db.query(`UPDATE purchase_sessions s SET payment_provider=p.provider,provider_order_id=p.provider_order_id,quote_hash=p.quote_hash FROM session_payment_links p WHERE s.session_id=p.session_id AND s.session_id=$1`,[s]);
 await beginProviderOperation('isolated',s,quote,'AUTHORIZE');await confirmProviderOperation('isolated',s,'AUTHORIZE','order-'+s,'auth-'+s);
 await db.query('UPDATE session_payment_links SET provider_authorization_id=$2 WHERE session_id=$1',[s,'auth-'+s]);
 await db.query("UPDATE purchase_sessions SET payment_provider='paypal',provider_order_id=$2,provider_authorization_id=$3 WHERE session_id=$1",[s,'order-'+s,'auth-'+s]);
}
async function evidence(s='s1'){
 const payload={event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'cap-'+s,status:'COMPLETED',amount:{value:'70',currency_code:'USD'},supplementary_data:{related_ids:{order_id:'order-'+s,authorization_id:'auth-'+s}}}};
 await db.query(`INSERT INTO session_payment_webhook_events(payload_hash,session_id,provider,event_type,provider_link_id,provider_payment_id,payload) VALUES($1,$2,'paypal','PAYMENT.CAPTURE.COMPLETED',$3,$4,$5::jsonb)`,['hash-'+s,s,'order-'+s,'cap-'+s,JSON.stringify(payload)]);
}
beforeAll(async()=>{
 db=await isolatedDatabase();
 await db.exec('CREATE TABLE api_clients(client_id text PRIMARY KEY,status text); CREATE TABLE whatsapp_authorized_chats(chat_id text PRIMARY KEY,revoked_at timestamptz);');
 for(const file of ['v10_1_intent_wallets.sql','v10_2_step_up.sql','v10_4_purchase_sessions.sql','v10_6_payment_proof.sql','v11_0_paypal_provider.sql','v11_0_1_multi_currency.sql','v11_0_2_capture_retry.sql','v11_0_3_late_capture.sql','v11_4_4_financial_access.sql','v11_4_5_wallet_reservations.sql'])await db.exec(readFileSync(new URL('../../db/'+file,import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
 vi.clearAllMocks();
 await db.exec(`TRUNCATE intent_wallets,financial_wallet_grants,financial_resource_owners CASCADE;
 INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,auto_buy_limit,max_single_transaction,valid_until) VALUES('w','wallet','USD',100,100,100,NOW()+INTERVAL '1 day'),('wb','other','USD',100,100,100,NOW()+INTERVAL '1 day');
 INSERT INTO financial_resource_owners(resource_type,resource_id,principal_id) VALUES('wallet','w','demo:a'),('wallet','wb','demo:b');
 INSERT INTO financial_wallet_grants(wallet_id,principal_id,permissions,expires_at,granted_by) VALUES('w','api:reader',ARRAY['read','authorize','execute'],NOW()+INTERVAL '1 day','test');`);
 await session('s1');
 const capabilities=new Map<string,any>();
 for(const key of ['a','b'] as const)capabilities.set(await sha256(tokens[key]),{principal_id:'demo:'+key,expires_at:new Date(Date.now()+600000).toISOString()});
 vi.mocked(repo.rateLimit).mockResolvedValue(true);
 vi.mocked(repo.capabilityByHash).mockImplementation(async(_db,hash)=>capabilities.get(hash)??null);
 vi.mocked(repo.claimNonce).mockResolvedValue(true);
 vi.mocked(repo.isDemoSession).mockResolvedValue(true);
 vi.mocked(findApiClientByHash).mockResolvedValue({clientId:'reader',status:'ACTIVE',scopes:['wallet:revoke','financial:read']} as any);
});
afterAll(async()=>{await db?.close();});
describe('POST /api/wallets/:id/revoke',()=>{
 it('maps to an owner-level wallet rule and is not reachable by GET',()=>{
  expect(accessRule('/api/wallets/w/revoke','POST')).toMatchObject({scope:'wallet:revoke',kind:'wallet',id:'w',permission:'approve'});
  expect(accessRule('/api/wallets/w/revoke','GET')).toBeNull();
 });
 it('revokes the owned wallet and reports in-flight reservations',async()=>{
  await reserve();
  const response=await call(post('w',tokens.a,{reason:'  agent\u0007 misbehaving '+'x'.repeat(300)}));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({alreadyRevoked:false,inFlight:{reservations:1},wallet:{walletId:'w',status:'REVOKED'}});
  expect(await status()).toBe('REVOKED');expect(await status('wb')).toBe('ACTIVE');
 });
 it('is idempotent',async()=>{
  expect((await call(post('w'))).status).toBe(200);
  const again=await call(post('w'));expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({alreadyRevoked:true,inFlight:{reservations:0},wallet:{status:'REVOKED'}});
 });
 it('accepts a missing body',async()=>{
  expect((await route(new Request('https://worker.test/api/wallets/w/revoke',{method:'POST'}),env)).status).toBe(200);
  expect(await status()).toBe('REVOKED');
 });
 it('returns 404 WALLET_NOT_FOUND for an unknown wallet once past the gate',async()=>{
  const r=await route(new Request('https://worker.test/api/wallets/nope/revoke',{method:'POST',body:'{}'}),env);
  expect(r.status).toBe(404);expect(await r.json()).toEqual({error:'WALLET_NOT_FOUND'});
 });
 it('does not distinguish unknown wallets from foreign wallets at the gate',async()=>{
  const missing=await call(post('nope'));const foreign=await call(post('wb'));
  expect(missing.status).toBe(404);expect(await missing.text()).toBe(await foreign.text());
  expect(await status('wb')).toBe('ACTIVE');
 });
 it('refuses a principal without the approve permission',async()=>{
  const r=await call(post('w','ilkey_reader'));
  expect(r.status).toBe(404);expect(await status()).toBe('ACTIVE');
 });
 it('lets a principal holding approve+read revoke, and requires authentication',async()=>{
  await db.exec("UPDATE financial_wallet_grants SET permissions=ARRAY['read','approve']");
  expect((await call(post('w','ilkey_reader'))).status).toBe(200);
  expect((await call(post('w',null))).status).toBe(401);
 });
 it('rejects an API client lacking the wallet:revoke scope',async()=>{
  await db.exec("UPDATE financial_wallet_grants SET permissions=ARRAY['read','approve']");
  vi.mocked(findApiClientByHash).mockResolvedValue({clientId:'reader',status:'ACTIVE',scopes:['financial:read']} as any);
  expect((await call(post('w','ilkey_reader'))).status).toBe(403);expect(await status()).toBe('ACTIVE');
 });
});
describe('revocation through existing SQL invariants',()=>{
 it('refuses new reservations',async()=>{
  expect((await call(post('w'))).status).toBe(200);
  await expect(reserve()).rejects.toThrow('WALLET_AUTHORITY_INACTIVE');
 });
 it('refuses the next provider step of an existing reservation',async()=>{
  await reserve();expect((await call(post('w'))).status).toBe(200);
  await expect(beginProviderOperation('isolated','s1',quote,'CHECKOUT')).rejects.toThrow('RESERVATION_NOT_EXECUTABLE');
 });
 it('still settles an already-requested capture from verified evidence',async()=>{
  await reserve();await authorized();await beginProviderOperation('isolated','s1',quote,'CAPTURE');await evidence();
  const body:any=await (await call(post('w'))).json();expect(body.inFlight.reservations).toBe(1);
  const result=await applyWalletSpendOnce('isolated',{sessionId:'s1',walletId:'w',amount:70,currency:'USD',provider:'paypal',providerLinkId:'order-s1',providerPaymentId:'cap-s1',verifiedPayPalPayloadHash:'hash-s1'});
  expect(result.applied).toBe(true);
  expect((await db.query<any>("SELECT spent_amount::text,reserved_amount::text,status FROM intent_wallets WHERE wallet_id='w'")).rows[0]).toEqual({spent_amount:'70.00',reserved_amount:'0',status:'REVOKED'});
  expect((await db.query('SELECT 1 FROM wallet_spend_ledger')).rows).toHaveLength(1);
 });
});
