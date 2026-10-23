import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {CLAIM_SESSION_RUN_SQL} from '../sessions/repository';
import {RESOLVE_STEP_UP_SQL} from '../wallets/atomic-stepup';
import {CONSUME_APPROVED_AUTHORIZATION_SQL} from '../wallets/atomic-stepup';
import {readFileSync} from 'node:fs';
let db:PGlite;
beforeAll(async()=>{db=new PGlite();await db.exec(`
 CREATE TABLE intent_wallets(wallet_id text primary key,status text,currency text,total_authority numeric,spent_amount numeric,max_single_transaction numeric,auto_buy_limit numeric,valid_until timestamptz,updated_at timestamptz);
 CREATE TABLE wallet_step_up_requests(request_id text primary key,wallet_id text,status text,expires_at timestamptz,quote_hash text,requested_amount numeric,additional_authority_required numeric,resolved_at timestamptz,resolution_payload jsonb);
 CREATE TABLE wallet_one_time_authorizations(authorization_id text primary key,request_id text unique,wallet_id text,quote_hash text,amount numeric,token_hash text,expires_at timestamptz,consumed_at timestamptz,consumed_by_session_id text);
 CREATE TABLE purchase_sessions(session_id text primary key,status text,selected_product jsonb,provider_order_id text,quote_hash text,authorization_id text,updated_at timestamptz,wallet_id text,step_up_request_id text,selected_decision text,completed_at timestamptz);
 ALTER TABLE purchase_sessions ADD COLUMN razorpay_payment_link_id text,ADD COLUMN razorpay_payment_id text,
 ADD COLUMN provider_authorization_id text,ADD COLUMN provider_capture_id text,ADD COLUMN payment_link_url text,
 ADD COLUMN payment_idempotency_key text,ADD COLUMN proof_receipt_id text,ADD COLUMN captured_amount numeric,ADD COLUMN captured_at timestamptz;
 CREATE TABLE session_payment_links(session_id text);
 `);
 const migration=readFileSync(new URL('../../db/v10_6_payment_proof.sql',import.meta.url),'utf8');
 await db.exec(migration.match(/CREATE OR REPLACE FUNCTION consume_wallet_one_time_authorization[\s\S]+?\$\$;/)![0]);
},30000);
beforeEach(async()=>{await db.exec(`TRUNCATE intent_wallets,wallet_step_up_requests,wallet_one_time_authorizations,purchase_sessions,session_payment_links;
 INSERT INTO intent_wallets VALUES('w','ACTIVE','USD',100,0,75,55,NOW()+INTERVAL '1 day',NOW());
 INSERT INTO wallet_step_up_requests VALUES('r','w','PENDING',NOW()+INTERVAL '10 minutes','hash',69,14,NULL,NULL);
 INSERT INTO purchase_sessions(session_id,status) VALUES('s','CREATED');`);});
afterAll(async()=>{await db?.close();});
const resolve=(status:string)=>db.query(RESOLVE_STEP_UP_SQL,['r','w',status,JSON.stringify({status}),'hash','a-'+status,'token',new Date(Date.now()+600000).toISOString()]);
describe('atomic session discovery',()=>{
 it('claims exactly one concurrent run',async()=>{
   const results=await Promise.all(Array.from({length:12},()=>db.query(CLAIM_SESSION_RUN_SQL,['s'])));
   expect(results.filter(r=>r.rows.length)).toHaveLength(1);
 });
 it.each(['SEARCHING','READY_TO_PAY','AWAITING_STEP_UP','CAPTURED','CAPTURE_PENDING','AUTHORIZED','PAYPAL_APPROVAL_PENDING','PAYMENT_PENDING','FAILED','BLOCKED','REJECTED','CANCELLED'])('preserves %s and selected evidence',async status=>{
   await db.query(`UPDATE purchase_sessions SET status=$1,selected_product='{"id":"original"}',provider_order_id='ORDER',quote_hash='quote' WHERE session_id='s'`,[status]);
   expect((await db.query(CLAIM_SESSION_RUN_SQL,['s'])).rows).toHaveLength(0);
   expect((await db.query('SELECT status,selected_product,provider_order_id FROM purchase_sessions')).rows[0]).toEqual({status,selected_product:{id:'original'},provider_order_id:'ORDER'});
 });
 it('does not run a corrupted CREATED session with payment evidence',async()=>{
   await db.exec("UPDATE purchase_sessions SET provider_order_id='ORDER'");
   expect((await db.query(CLAIM_SESSION_RUN_SQL,['s'])).rows).toHaveLength(0);
 });
 it('rejects legacy payment evidence and an existing payment reservation',async()=>{
   await db.exec("UPDATE purchase_sessions SET razorpay_payment_link_id='legacy'");
   expect((await db.query(CLAIM_SESSION_RUN_SQL,['s'])).rows).toHaveLength(0);
   await db.exec("UPDATE purchase_sessions SET razorpay_payment_link_id=NULL;INSERT INTO session_payment_links VALUES('s')");
   expect((await db.query(CLAIM_SESSION_RUN_SQL,['s'])).rows).toHaveLength(0);
 });
});
describe('STEP-UP atomic effects',()=>{
 it('serializes competing approve/reject/raise calls and their effects',async()=>{
   await db.exec("UPDATE purchase_sessions SET status='AWAITING_STEP_UP',wallet_id='w',step_up_request_id='r',selected_decision='STEP_UP'");
   const statuses=['APPROVED_ONCE','REJECTED','LIMIT_RAISED'];
   const results=await Promise.all(statuses.map(resolve));
   expect(results.filter(r=>r.rows.length)).toHaveLength(1);
   const winner=(await db.query<{status:string}>('SELECT status FROM wallet_step_up_requests')).rows[0].status;
   expect((await db.query('SELECT * FROM wallet_one_time_authorizations')).rows).toHaveLength(winner==='APPROVED_ONCE'?1:0);
   expect(Number((await db.query<{auto_buy_limit:string}>('SELECT auto_buy_limit FROM intent_wallets')).rows[0].auto_buy_limit)).toBe(winner==='LIMIT_RAISED'?69:55);
   expect((await db.query('SELECT status,authorization_id FROM purchase_sessions')).rows[0]).toEqual({status:winner==='REJECTED'?'REJECTED':'READY_TO_PAY',authorization_id:winner==='APPROVED_ONCE'?'a-APPROVED_ONCE':null});
 });
 it.each(['REJECTED','APPROVED_ONCE','LIMIT_RAISED','EXPIRED'])('grants no new authority after %s',async status=>{
   await db.query('UPDATE wallet_step_up_requests SET status=$1',[status]);
   for(const action of ['APPROVED_ONCE','LIMIT_RAISED'])expect((await resolve(action)).rows).toHaveLength(0);
   expect((await db.query('SELECT * FROM wallet_one_time_authorizations')).rows).toHaveLength(0);
 });
 it('leaves neither grant nor limit effect after expiry',async()=>{
   await db.exec("UPDATE wallet_step_up_requests SET expires_at=NOW()-INTERVAL '1 second'");
   expect((await resolve('APPROVED_ONCE')).rows).toHaveLength(0);
   expect((await resolve('LIMIT_RAISED')).rows).toHaveLength(0);
 });
 it('rolls back resolution if token persistence fails',async()=>{
   await db.exec("INSERT INTO wallet_one_time_authorizations(authorization_id,request_id,wallet_id,quote_hash,amount,token_hash,expires_at) VALUES('a-APPROVED_ONCE','other','w','hash',69,'other',NOW())");
   await expect(resolve('APPROVED_ONCE')).rejects.toThrow();
   expect((await db.query('SELECT status FROM wallet_step_up_requests')).rows[0]).toEqual({status:'PENDING'});
 });
 it('does not raise limits for risk-only consent or spent/revoked wallets',async()=>{
   await db.exec('UPDATE wallet_step_up_requests SET additional_authority_required=0');
   expect((await resolve('LIMIT_RAISED')).rows).toHaveLength(0);
   await db.exec("UPDATE intent_wallets SET spent_amount=50,status='REVOKED'");
   expect((await resolve('APPROVED_ONCE')).rows).toHaveLength(0);
 });
 it('consumes a winning grant once, permits same-session recovery and rejects another session',async()=>{
   await resolve('APPROVED_ONCE');
   const consume=(session:string)=>db.query<any>(CONSUME_APPROVED_AUTHORIZATION_SQL,['a-APPROVED_ONCE','w',session,'hash',69]);
   expect((await consume('s')).rows[0]).toMatchObject({consumed:true,reason:'CONSUMED'});
   expect((await consume('s')).rows[0]).toMatchObject({consumed:true,reason:'ALREADY_CONSUMED_BY_THIS_SESSION'});
   expect((await consume('other')).rows[0]).toMatchObject({consumed:false,reason:'AUTHORIZATION_ALREADY_CONSUMED'});
   expect((await resolve('REJECTED')).rows).toHaveLength(0);
 });
 it('never consumes a historical orphan grant attached to rejection',async()=>{
   await resolve('APPROVED_ONCE');await db.exec("UPDATE wallet_step_up_requests SET status='REJECTED'");
   expect((await db.query(CONSUME_APPROVED_AUTHORIZATION_SQL,['a-APPROVED_ONCE','w','s','hash',69])).rows).toHaveLength(0);
   expect((await db.query('SELECT consumed_at FROM wallet_one_time_authorizations')).rows[0]).toEqual({consumed_at:null});
 });
});
