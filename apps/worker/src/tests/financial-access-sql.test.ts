import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {isolatedDatabase,type IsolatedDatabase} from './isolated-database';
import {readFileSync} from 'node:fs';
import {WALLET_ACCESS_SQL,RATE_LIMIT_SQL,ROTATE_CAPABILITY_SQL,CLAIM_NONCE_SQL} from '../access/repository';
import {LIST_WALLETS_SQL,createWallet} from '../wallets/repository';
import {LIST_SESSIONS_SQL} from '../sessions/repository';
import {CLAIM_EXECUTION_JOB_SQL} from '../access/jobs';
import {handleGrantAdmin} from '../access/grant-admin';
let db:IsolatedDatabase;
vi.mock('@neondatabase/serverless',()=>({neon:()=>{
 const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{let query=parts[0];for(let i=0;i<values.length;i++)query+='$'+(i+1)+parts[i+1];return (await db.query(query,values)).rows;};
 sql.query=async(query:string,values:unknown[])=> (await db.query(query,values)).rows;return sql;
}}));
beforeAll(async()=>{
 db=await isolatedDatabase();await db.exec(readFileSync(new URL('../../db/v10_1_intent_wallets.sql',import.meta.url),'utf8'));
 await db.exec(`ALTER TABLE intent_wallets ADD COLUMN country_code text DEFAULT 'US';
 CREATE TABLE purchase_sessions(session_id text primary key,wallet_id text REFERENCES intent_wallets(wallet_id),connector_id text,created_at timestamptz DEFAULT NOW());
 CREATE TABLE api_clients(client_id text PRIMARY KEY,status text);
 CREATE TABLE whatsapp_authorized_chats(chat_id text PRIMARY KEY,revoked_at timestamptz);`);
 await db.exec(readFileSync(new URL('../../db/v11_4_4_financial_access.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
 await db.exec(`TRUNCATE api_clients,whatsapp_authorized_chats,financial_access_admin_events,financial_execution_jobs,financial_access_nonces,financial_access_rate_limits,financial_demo_capabilities,financial_wallet_grants,financial_resource_owners,purchase_sessions,intent_wallets CASCADE;
 INSERT INTO api_clients VALUES('client-a','ACTIVE');
 INSERT INTO whatsapp_authorized_chats VALUES('chat-a',NULL);
 INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,auto_buy_limit,max_single_transaction,valid_until) VALUES
 ('wallet-a','A','USD',100,55,75,NOW()+INTERVAL '1 day'),('wallet-b','B','USD',100,55,75,NOW()+INTERVAL '1 day'),('historical','legacy','USD',100,55,75,NOW()+INTERVAL '1 day');
 INSERT INTO financial_resource_owners(resource_type,resource_id,principal_id) VALUES('wallet','wallet-a','demo:a'),('wallet','wallet-b','demo:b');
 INSERT INTO purchase_sessions(session_id,wallet_id,connector_id) VALUES('session-a','wallet-a','paypal-demo-marketplace'),('session-b','wallet-b','paypal-demo-marketplace');`);
});
describe('server-side grant administration',()=>{
 const env={DATABASE_URL:'isolated',INTENTLOCK_ADMIN_KEY:'isolated-admin-key'};
 const req=(body:unknown,key='isolated-admin-key',revoke=false)=>new Request('https://worker.test/v1/admin/wallet-grants'+(revoke?'/revoke':''),{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});
 it('rejects a browser capability or forged principal without an administrator credential',async()=>{
   expect((await handleGrantAdmin(req({walletId:'historical',clientId:'client-a',principalId:'demo:a'},'ildemo_'+'a'.repeat(64)),env)).status).toBe(401);
   expect((await db.query('SELECT * FROM financial_wallet_grants')).rows).toHaveLength(0);
 });
 it('grants and revokes a verified client with atomic administrative audit records',async()=>{
   const body={walletId:'historical',clientId:'client-a',principalId:'demo:a',permissions:['read','authorize']};
   expect((await handleGrantAdmin(req(body),env)).status).toBe(201);expect(await access('historical','api:client-a','authorize')).toBe(true);expect(await access('historical','demo:a')).toBe(false);
   expect((await db.query('SELECT action FROM financial_access_admin_events')).rows).toEqual([{action:'GRANT'}]);
   expect((await handleGrantAdmin(req(body,undefined,true),env)).status).toBe(200);expect(await access('historical','api:client-a')).toBe(false);
   expect((await db.query('SELECT action FROM financial_access_admin_events ORDER BY occurred_at')).rows).toEqual([{action:'GRANT'},{action:'REVOKE'}]);
 });
 it('rejects invalid scopes, expiry and unknown target identities',async()=>{
   for(const patch of [{permissions:['*']},{expiresAt:'2000-01-01T00:00:00Z'},{clientId:'missing'}])expect((await handleGrantAdmin(req({walletId:'historical',clientId:'client-a',...patch}),env)).status).toBeGreaterThanOrEqual(400);
   expect((await db.query('SELECT * FROM financial_wallet_grants')).rows).toHaveLength(0);
 });
 it('derives a paired WhatsApp principal without trusting a submitted owner',async()=>{
   const response=await handleGrantAdmin(req({walletId:'historical',chatId:'chat-a',permissions:['read'],ownerId:'demo:a'}),env);expect(response.status).toBe(201);
   const grant=(await db.query<any>('SELECT principal_id FROM financial_wallet_grants')).rows[0];expect(grant.principal_id).toMatch(/^wa:[a-f0-9]{64}$/);expect(await access('historical','demo:a')).toBe(false);
 });
});
afterAll(async()=>{await db?.close();});
const access=async(wallet:string,principal:string,permission='read')=>(await db.query(WALLET_ACCESS_SQL,[wallet,principal,permission])).rows.length===1;
describe('real ownership and grant SQL',()=>{
 it('isolates visitors across wallets and session lists',async()=>{
   expect(await access('wallet-a','demo:a')).toBe(true);expect(await access('wallet-b','demo:a')).toBe(false);
   expect((await db.query<any>(LIST_WALLETS_SQL,['demo:a'])).rows.map(r=>r.wallet_id)).toEqual(['wallet-a']);
   expect((await db.query<any>(LIST_SESSIONS_SQL,['demo:a'])).rows.map(r=>r.session_id)).toEqual(['session-a']);
 });
 it('does not grant historical resources to the first caller',async()=>{
   expect(await access('historical','demo:a')).toBe(false);expect(await access('historical','api:client-a')).toBe(false);
 });
 it('enforces cross-client and permission-scoped grants with expiry and revocation',async()=>{
   await db.exec("INSERT INTO financial_wallet_grants(wallet_id,principal_id,permissions,expires_at,granted_by) VALUES('historical','api:client-a',ARRAY['read','authorize'],NOW()+INTERVAL '1 hour','admin:test')");
   expect(await access('historical','api:client-a','authorize')).toBe(true);expect(await access('historical','api:client-b','authorize')).toBe(false);
   expect(await access('historical','api:client-a','execute')).toBe(false);expect(await access('historical','api:client-a','approve')).toBe(false);
   await db.exec('UPDATE financial_wallet_grants SET revoked_at=NOW()');expect(await access('historical','api:client-a')).toBe(false);
   await db.exec("UPDATE financial_wallet_grants SET revoked_at=NULL,expires_at=NOW()-INTERVAL '1 second'");expect(await access('historical','api:client-a')).toBe(false);
 });
 it('assigns wallet and ownership in one statement and rolls both back on ownership failure',async()=>{
   const input={name:'new',currency:'USD',countryCode:'US',totalAuthority:100,autoBuyLimit:55,maxSingleTransaction:75,allowedCategories:[],allowedBrands:[],blockedBrands:[],requiredFeatures:[],validUntil:'2099-01-01T00:00:00.000Z'};
   const wallet=await createWallet('isolated',input,'demo:new');expect(await access(wallet.walletId,'demo:new')).toBe(true);expect(await access(wallet.walletId,'demo:a')).toBe(false);
   const before=(await db.query<any>('SELECT COUNT(*) n FROM intent_wallets')).rows[0].n;
   await expect(createWallet('isolated',input,'forged-owner')).rejects.toThrow();
   expect((await db.query<any>('SELECT COUNT(*) n FROM intent_wallets')).rows[0].n).toBe(before);
 });
 it('filters before LIMIT, so other visitors cannot crowd out owned resources',async()=>{
   await db.exec("INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,auto_buy_limit,max_single_transaction,valid_until) SELECT 'other-'||i,'other','USD',100,55,75,NOW()+INTERVAL '1 day' FROM generate_series(1,70) i");
   expect((await db.query<any>(LIST_WALLETS_SQL,['demo:a'])).rows.map(r=>r.wallet_id)).toEqual(['wallet-a']);
 });
});
describe('capability rotation, nonce and abuse SQL',()=>{
 it('rotates only once under concurrent replay',async()=>{
   await db.exec("INSERT INTO financial_demo_capabilities VALUES('old','demo:a',NOW()+INTERVAL '1 hour',NULL,NOW())");
   const expiry=new Date(Date.now()+1800000).toISOString();
   const results=await Promise.all(['new-a','new-b'].map(hash=>db.query(ROTATE_CAPABILITY_SQL,['old',hash,expiry])));
   expect(results.filter(r=>r.rows.length)).toHaveLength(1);
   expect((await db.query('SELECT * FROM financial_demo_capabilities WHERE revoked_at IS NULL')).rows).toHaveLength(1);
 });
 it('cannot refresh an expired capability',async()=>{
   await db.exec("INSERT INTO financial_demo_capabilities VALUES('old','demo:a',NOW()-INTERVAL '1 second',NULL,NOW())");
   expect((await db.query(ROTATE_CAPABILITY_SQL,['old','new',new Date(Date.now()+1800000).toISOString()])).rows).toHaveLength(0);
 });
 it('claims exactly one mutation nonce and isolates principals',async()=>{
   const expiry=new Date(Date.now()+1800000).toISOString();
   const results=await Promise.all(Array.from({length:12},()=>db.query(CLAIM_NONCE_SQL,['demo:a','request',expiry])));
   expect(results.filter(r=>r.rows.length)).toHaveLength(1);
   expect((await db.query(CLAIM_NONCE_SQL,['demo:b','request',expiry])).rows).toHaveLength(1);
 });
 it('counts concurrent requests atomically and resets expired windows',async()=>{
   const expiry=new Date(Date.now()+60000).toISOString();
   const results=await Promise.all(Array.from({length:12},()=>db.query<any>(RATE_LIMIT_SQL,['bucket',expiry])));
   expect(results.map(r=>r.rows[0].attempts).sort((a,b)=>a-b)).toEqual(Array.from({length:12},(_,i)=>i+1));
   await db.exec("UPDATE financial_access_rate_limits SET expires_at=NOW()-INTERVAL '1 second'");
   expect((await db.query<any>(RATE_LIMIT_SQL,['bucket',expiry])).rows[0].attempts).toBe(1);
 });
});
describe('queue execution identity SQL',()=>{
 it('binds the session, principal, kind and reply destination; claims only one consumer',async()=>{
   await db.exec("INSERT INTO financial_execution_jobs(job_id,session_id,principal_id,kind,chat_id,waha_session,expires_at) VALUES('j','session-a','wa:a','RUN_PURCHASE','chat-a','waha-a',NOW()+INTERVAL '1 hour')");
   const params=['j','session-a','wa:a','RUN_PURCHASE','chat-a','waha-a'];
   for(const index of [1,2,3,4,5]){const forged=[...params];forged[index]='forged';expect((await db.query(CLAIM_EXECUTION_JOB_SQL,forged)).rows).toHaveLength(0);}
   const claimed=await Promise.all(Array.from({length:8},()=>db.query(CLAIM_EXECUTION_JOB_SQL,params)));
   expect(claimed.filter(r=>r.rows.length)).toHaveLength(1);
 });
 it('will not claim expired or already completed work',async()=>{
   await db.exec("INSERT INTO financial_execution_jobs(job_id,session_id,principal_id,kind,chat_id,waha_session,expires_at,status) VALUES('j','session-a','wa:a','RUN_PURCHASE','chat-a','waha-a',NOW()-INTERVAL '1 second','PENDING')");
   const p=['j','session-a','wa:a','RUN_PURCHASE','chat-a','waha-a'];expect((await db.query(CLAIM_EXECUTION_JOB_SQL,p)).rows).toHaveLength(0);
   await db.exec("UPDATE financial_execution_jobs SET expires_at=NOW()+INTERVAL '1 hour',status='DONE'");expect((await db.query(CLAIM_EXECUTION_JOB_SQL,p)).rows).toHaveLength(0);
 });
});
