import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {isolatedDatabase,type IsolatedDatabase} from './isolated-database';
import {readFileSync} from 'node:fs';
import {reserveWalletAuthority,beginProviderOperation,confirmProviderOperation,releaseUnusedReservation,reconcileWalletReservation,releaseVerifiedDeniedCapture} from '../session-payments/reservations';
import {applyWalletSpendOnce} from '../session-payments/repository';
import {RESOLVE_STEP_UP_SQL} from '../wallets/atomic-stepup';
let db:IsolatedDatabase;
vi.mock('@neondatabase/serverless',()=>({neon:()=>{
 const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{let query=parts[0];for(let i=0;i<values.length;i++)query+='$'+(i+1)+parts[i+1];return (await db.query(query,values)).rows;};
 sql.query=async(query:string,values:unknown[])=> (await db.query(query,values)).rows;return sql;
}}));
vi.mock('../session-payments/providers/paypal',()=>({getPayPalReservationTruth:vi.fn()}));
vi.mock('../session-payments/audit',()=>({appendSessionAuditEvent:vi.fn()}));
import {getPayPalReservationTruth} from '../session-payments/providers/paypal';
const quote='a'.repeat(64);
const reserve=(session='s1',amount=70,currency='USD',wallet='w',provider='paypal')=>reserveWalletAuthority('isolated',{sessionId:session,walletId:wallet,quoteHash:quote,idempotencyKey:'key-'+session,amount,currency,provider});
async function session(id:string,amount=70,currency='USD',wallet='w',context?:object){
 await db.query(`INSERT INTO purchase_sessions(session_id,wallet_id,user_prompt,status,selected_product,selected_decision) VALUES($1,$2,'test','READY_TO_PAY',$3::jsonb,'ALLOW')`,[id,wallet,JSON.stringify({id:'p',price:amount,currency,...context})]);
}
const snapshot=async()=> (await db.query<any>("SELECT spent_amount::text,reserved_amount::text FROM intent_wallets WHERE wallet_id='w'")).rows[0];
const state=async(s='s1')=>(await db.query<any>('SELECT state,phase FROM wallet_authority_reservations WHERE session_id=$1',[s])).rows[0];
async function checkout(s='s1'){
 await beginProviderOperation('isolated',s,quote,'CHECKOUT');
 await confirmProviderOperation('isolated',s,'CHECKOUT','order-'+s);
 await db.query(`INSERT INTO session_payment_links(session_id,wallet_id,quote_hash,idempotency_key,provider,provider_order_id,amount,currency)
 SELECT session_id,wallet_id,quote_hash,operation_key,provider,provider_order_id,amount,currency FROM wallet_authority_reservations WHERE session_id=$1`,[s]);
 await db.query(`UPDATE purchase_sessions s SET payment_provider=p.provider,provider_order_id=p.provider_order_id,quote_hash=p.quote_hash FROM session_payment_links p WHERE s.session_id=p.session_id AND s.session_id=$1`,[s]);
}
async function authorized(s='s1'){
 await beginProviderOperation('isolated',s,quote,'AUTHORIZE');
 await confirmProviderOperation('isolated',s,'AUTHORIZE','order-'+s,'auth-'+s);
 await db.query("UPDATE session_payment_links SET provider_authorization_id=$2 WHERE session_id=$1",[s,'auth-'+s]);
 await db.query("UPDATE purchase_sessions SET payment_provider='paypal',provider_order_id=$2,provider_authorization_id=$3 WHERE session_id=$1",[s,'order-'+s,'auth-'+s]);
}
async function evidence(s='s1',amount=70,currency='USD'){
 const payload={event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'cap-'+s,status:'COMPLETED',amount:{value:String(amount),currency_code:currency},supplementary_data:{related_ids:{order_id:'order-'+s,authorization_id:'auth-'+s}}}};
 await db.query(`INSERT INTO session_payment_webhook_events(payload_hash,session_id,provider,event_type,provider_link_id,provider_payment_id,payload) VALUES($1,$2,'paypal','PAYMENT.CAPTURE.COMPLETED',$3,$4,$5::jsonb) ON CONFLICT DO NOTHING`,['hash-'+s,s,'order-'+s,'cap-'+s,JSON.stringify(payload)]);
}
const settle=(s='s1',amount=70,currency='USD')=>applyWalletSpendOnce('isolated',{sessionId:s,walletId:'w',amount,currency,provider:'paypal',providerLinkId:'order-'+s,providerPaymentId:'cap-'+s,verifiedPayPalPayloadHash:'hash-'+s});
beforeAll(async()=>{
 db=await isolatedDatabase();
 for(const file of ['v10_1_intent_wallets.sql','v10_2_step_up.sql','v10_4_purchase_sessions.sql','v10_6_payment_proof.sql','v11_0_paypal_provider.sql','v11_0_1_multi_currency.sql','v11_0_2_capture_retry.sql','v11_0_3_late_capture.sql','v11_4_5_wallet_reservations.sql'])await db.exec(readFileSync(new URL('../../db/'+file,import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
 vi.clearAllMocks();
 await db.exec(`TRUNCATE intent_wallets CASCADE;
 INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,auto_buy_limit,max_single_transaction,valid_until) VALUES('w','wallet','USD',100,100,100,NOW()+INTERVAL '1 day'),('other','other','USD',100,100,100,NOW()+INTERVAL '1 day');`);
 await session('s1');await session('s2');
});
afterAll(async()=>{await db?.close();});
describe('atomic PostgreSQL wallet reservation functions',()=>{
 it('admits only one of two 70-dollar sessions against 100 dollars',async()=>{
  const results=await Promise.allSettled([reserve(),reserve('s2')]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(await snapshot()).toEqual({spent_amount:'0.00',reserved_amount:'70'});
 });
 it('twenty simultaneous contenders never exceed aggregate authority',async()=>{
  for(let i=0;i<20;i++)await session('many'+i,7);
  const results=await Promise.allSettled(Array.from({length:20},(_,i)=>reserve('many'+i,7)));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(14);expect(Number((await snapshot()).reserved_amount)).toBe(98);
 });
 it('same-session retries reserve exactly once and reject identity changes',async()=>{
  const rows=await Promise.all(Array.from({length:20},()=>reserve()));expect(new Set(rows.map(r=>r.reservation_id)).size).toBe(1);
  expect(Number((await snapshot()).reserved_amount)).toBe(70);await expect(reserve('s1',69)).rejects.toThrow('RESERVATION_IDENTITY_MISMATCH');
 });
 it('rejects a session belonging to a different wallet',async()=>{
  await expect(reserve('s1',70,'USD','other')).rejects.toThrow('RESERVATION_SESSION_WALLET_MISMATCH');
 });
 it.each([NaN,Infinity,0,-1,1.001])('rejects malformed or sub-minor-unit amount %s',async amount=>{
  await expect(reserve('s1',amount)).rejects.toThrow();expect(Number((await snapshot()).reserved_amount)).toBe(0);
 });
 it('checks the SQL boundary independently of JavaScript validation',async()=>{
  await expect(db.query('SELECT * FROM reserve_wallet_authority_v11_4_5($1,$2,$3,$4,$5,$6,$7)',['s1','w',quote,'key','NaN','USD','paypal'])).rejects.toThrow('RESERVATION_AMOUNT_INVALID');
 });
 it('keeps provider timeout authority and blocks a second payment or retry',async()=>{
  await reserve();await beginProviderOperation('isolated','s1',quote,'CHECKOUT');
  expect(await releaseUnusedReservation('isolated','s1',true)).toBe(false);
  await expect(beginProviderOperation('isolated','s1',quote,'CHECKOUT')).rejects.toThrow('RESERVATION_NOT_EXECUTABLE');
  await expect(reserve('s2')).rejects.toThrow('WALLET_AVAILABLE_AUTHORITY_EXCEEDED');
  expect(await state()).toEqual({state:'RECONCILIATION_REQUIRED',phase:'CHECKOUT'});
 });
 it('releases a known pre-dispatch failure and cannot resurrect it',async()=>{
  await reserve();expect(await releaseUnusedReservation('isolated','s1')).toBe(true);expect(await releaseUnusedReservation('isolated','s1')).toBe(false);
  await expect(reserve()).rejects.toThrow('RESERVATION_TERMINAL');expect(Number((await snapshot()).reserved_amount)).toBe(0);
 });
 it('expires abandoned PayPal approval without ever authorizing it',async()=>{
  await db.exec("UPDATE intent_wallets SET valid_until=NOW()+INTERVAL '1 second' WHERE wallet_id='w'");
  await reserve();await checkout();
  await new Promise(resolve=>setTimeout(resolve,1100));
  expect(await releaseUnusedReservation('isolated','s1',true)).toBe(true);
  await expect(beginProviderOperation('isolated','s1',quote,'AUTHORIZE')).rejects.toThrow('RESERVATION_NOT_EXECUTABLE');
 });
 it.each(['AUTHORIZE','CAPTURE'] as const)('never expires a possibly dispatched %s',async phase=>{
  await reserve();await checkout();if(phase==='CAPTURE')await authorized();
  await beginProviderOperation('isolated','s1',quote,phase);
  expect(await releaseUnusedReservation('isolated','s1',true)).toBe(false);
  expect(Number((await snapshot()).reserved_amount)).toBe(70);
 });
 it('settles a capture timeout exactly once from concurrent verified webhook replay',async()=>{
  await reserve();await checkout();await authorized();await beginProviderOperation('isolated','s1',quote,'CAPTURE');await evidence();
  const results=await Promise.all(Array.from({length:20},()=>settle()));expect(results.filter(r=>r.applied)).toHaveLength(1);
  expect((await db.query('SELECT * FROM wallet_spend_ledger')).rows).toHaveLength(1);
  expect(await snapshot()).toEqual({spent_amount:'70.00',reserved_amount:'0'});expect((await state()).state).toBe('COMMITTED');
  await confirmProviderOperation('isolated','s1','CAPTURE','order-s1','auth-s1','cap-s1');expect((await state()).state).toBe('COMMITTED');
 });
 it('does not settle merely on a successful capture response or mismatched webhook',async()=>{
  await reserve();await checkout();await authorized();await beginProviderOperation('isolated','s1',quote,'CAPTURE');
  await expect(settle()).rejects.toThrow('VERIFIED_SETTLEMENT_EVIDENCE_REQUIRED');await evidence('s1',69);
  await expect(settle()).rejects.toThrow('VERIFIED_SETTLEMENT_EVIDENCE_MISMATCH');expect(Number((await snapshot()).reserved_amount)).toBe(70);
 });
 it('revocation or expiry blocks capture but cannot corrupt an already exercised verified settlement',async()=>{
  await reserve();await checkout();await authorized();
  await db.exec("UPDATE intent_wallets SET status='REVOKED' WHERE wallet_id='w'");
  await expect(beginProviderOperation('isolated','s1',quote,'CAPTURE')).rejects.toThrow('RESERVATION_NOT_EXECUTABLE');
  await db.exec("UPDATE intent_wallets SET status='ACTIVE' WHERE wallet_id='w'");await beginProviderOperation('isolated','s1',quote,'CAPTURE');
  await db.exec("UPDATE intent_wallets SET status='REVOKED',valid_until=NOW()-INTERVAL '1 day' WHERE wallet_id='w'");await evidence();
  expect((await settle()).applied).toBe(true);expect((await settle()).applied).toBe(false);
 });
 it.each(["status='REVOKED'","valid_until=NOW()-INTERVAL '1 day'"])('blocks new reservations after %s',async update=>{
  await db.exec('UPDATE intent_wallets SET '+update+" WHERE wallet_id='w'");await expect(reserve()).rejects.toThrow('WALLET_AUTHORITY_INACTIVE');expect(Number((await snapshot()).reserved_amount)).toBe(0);
 });
 it('blocks authorization when the wallet expires after buyer approval',async()=>{
  await reserve();await checkout();await db.exec("UPDATE intent_wallets SET valid_until=NOW()-INTERVAL '1 day' WHERE wallet_id='w'");
  await expect(beginProviderOperation('isolated','s1',quote,'AUTHORIZE')).rejects.toThrow('RESERVATION_NOT_EXECUTABLE');expect(Number((await snapshot()).reserved_amount)).toBe(70);
 });
 it('rejects lowered hard limits and lost one-time approval at the dispatch boundary',async()=>{
  await reserve();await checkout();await db.exec("UPDATE intent_wallets SET max_single_transaction=60,auto_buy_limit=50 WHERE wallet_id='w'");
  await expect(beginProviderOperation('isolated','s1',quote,'AUTHORIZE')).rejects.toThrow('RESERVATION_NOT_EXECUTABLE');
  await db.exec("UPDATE intent_wallets SET max_single_transaction=100,auto_buy_limit=50 WHERE wallet_id='w'");
  await expect(beginProviderOperation('isolated','s1',quote,'AUTHORIZE')).rejects.toThrow('RESERVATION_APPROVAL_REQUIRED');
 });
 it('requires provider truth for releasing a voided authorization and never releases an ambiguous capture',async()=>{
  await reserve();await checkout();await authorized();
  vi.mocked(getPayPalReservationTruth).mockResolvedValue({order:{id:'order-s1',intent:'AUTHORIZE',purchase_units:[{payments:{}}]},authorization:{id:'auth-s1',status:'VOIDED'}});
  expect(await reconcileWalletReservation({DATABASE_URL:'isolated'},'s1')).toMatchObject({released:true,state:'RELEASED'});
  expect(Number((await snapshot()).reserved_amount)).toBe(0);
 });
 it('does not release voided-looking provider truth after capture dispatch',async()=>{
  await reserve();await checkout();await authorized();await beginProviderOperation('isolated','s1',quote,'CAPTURE');
  expect(await reconcileWalletReservation({DATABASE_URL:'isolated'},'s1')).toMatchObject({released:false,reconciliationRequired:true});expect(getPayPalReservationTruth).not.toHaveBeenCalled();
 });
 it('recovers an authorization timeout using provider truth without repeating authorization',async()=>{
  await reserve();await checkout();await beginProviderOperation('isolated','s1',quote,'AUTHORIZE');
  const authorization={id:'auth-s1',status:'CREATED',amount:{value:'70.00',currency_code:'USD'}};
  vi.mocked(getPayPalReservationTruth).mockResolvedValue({order:{id:'order-s1',intent:'AUTHORIZE',purchase_units:[{custom_id:'s1',payments:{authorizations:[authorization]}}]},authorization});
  await reconcileWalletReservation({DATABASE_URL:'isolated'},'s1');
  expect(await state()).toEqual({state:'RESERVED',phase:'AUTHORIZE'});
  expect((await db.query<any>("SELECT provider_authorization_id FROM session_payment_links WHERE session_id='s1'")).rows[0].provider_authorization_id).toBe('auth-s1');
  expect(Number((await snapshot()).reserved_amount)).toBe(70);
 });
 it('does not bind a provider authorization belonging to a different session',async()=>{
  await reserve();await checkout();await beginProviderOperation('isolated','s1',quote,'AUTHORIZE');
  const authorization={id:'auth-s1',status:'CREATED',amount:{value:'70.00',currency_code:'USD'}};
  vi.mocked(getPayPalReservationTruth).mockResolvedValue({order:{id:'order-s1',intent:'AUTHORIZE',purchase_units:[{custom_id:'foreign-session',payments:{authorizations:[authorization]}}]},authorization});
  expect(await reconcileWalletReservation({DATABASE_URL:'isolated'},'s1')).toMatchObject({released:false,reconciliationRequired:true});expect((await state()).state).toBe('RECONCILIATION_REQUIRED');
 });
 it('releases a verified terminal capture denial once, including a lost capture response',async()=>{
  await reserve();await checkout();await authorized();await beginProviderOperation('isolated','s1',quote,'CAPTURE');await evidence();
  await db.exec("UPDATE session_payment_webhook_events SET event_type='PAYMENT.CAPTURE.DENIED',payload=jsonb_set(jsonb_set(payload,'{event_type}','\"PAYMENT.CAPTURE.DENIED\"'),'{resource,status}','\"DECLINED\"')");
  expect(await releaseVerifiedDeniedCapture('isolated','s1','hash-s1')).toBe(true);expect(await releaseVerifiedDeniedCapture('isolated','s1','hash-s1')).toBe(false);
  expect((await state()).state).toBe('RELEASED');expect(Number((await snapshot()).reserved_amount)).toBe(0);expect((await db.query('SELECT * FROM wallet_spend_ledger')).rows).toHaveLength(0);
 });
 it('cannot release or reverse a committed capture with an out-of-order denial',async()=>{
  await reserve();await checkout();await authorized();await beginProviderOperation('isolated','s1',quote,'CAPTURE');await evidence();await settle();
  expect(await releaseVerifiedDeniedCapture('isolated','s1','not-a-denial')).toBe(false);expect((await state()).state).toBe('COMMITTED');expect(Number((await snapshot()).spent_amount)).toBe(70);
 });
 it('rejects forged or mismatched denial evidence without freeing authority',async()=>{
  await reserve();await checkout();await authorized();await beginProviderOperation('isolated','s1',quote,'CAPTURE');await evidence();
  await db.exec("UPDATE session_payment_webhook_events SET event_type='PAYMENT.CAPTURE.DENIED'");
  await expect(releaseVerifiedDeniedCapture('isolated','s1','hash-s1')).rejects.toThrow('VERIFIED_DENIAL_MISMATCH');expect(Number((await snapshot()).reserved_amount)).toBe(70);
 });
 it('commits Razorpay reservations only against exact signed-ingress evidence',async()=>{
  await db.exec("UPDATE intent_wallets SET currency='INR' WHERE wallet_id='w';UPDATE purchase_sessions SET selected_product=jsonb_set(selected_product,'{currency}','\"INR\"') WHERE session_id='s1'");
  await reserve('s1',70,'INR','w','razorpay');await checkout();
  const payload={payload:{payment_link:{entity:{id:'order-s1'}},payment:{entity:{id:'cap-s1',amount:7000,currency:'INR',status:'captured'}}}};
  await db.query(`INSERT INTO session_payment_webhook_events(payload_hash,session_id,provider,event_type,provider_link_id,provider_payment_id,payload) VALUES('razor-hash','s1','razorpay','payment_link.paid','order-s1','cap-s1',$1::jsonb)`,[JSON.stringify(payload)]);
  const input={sessionId:'s1',walletId:'w',amount:70,currency:'INR',provider:'razorpay' as const,providerLinkId:'order-s1',providerPaymentId:'cap-s1',verifiedWebhookPayloadHash:'razor-hash'};
  expect((await applyWalletSpendOnce('isolated',input)).applied).toBe(true);expect((await applyWalletSpendOnce('isolated',input)).applied).toBe(false);expect(Number((await snapshot()).reserved_amount)).toBe(0);
 });
 it('enforces identity, terminal states and counter conservation even on direct SQL writes',async()=>{
  await reserve();await expect(db.exec("UPDATE wallet_authority_reservations SET amount=1")).rejects.toThrow('RESERVATION_IDENTITY_IMMUTABLE');
  await expect(db.exec("UPDATE wallet_authority_reservations SET state='COMMITTED'")).rejects.toThrow('RESERVATION_LEDGER_REQUIRED');
  await expect(db.exec("UPDATE intent_wallets SET spent_amount=50 WHERE wallet_id='w'")).rejects.toThrow();expect(Number((await snapshot()).reserved_amount)).toBe(70);
  await expect(db.exec("UPDATE intent_wallets SET reserved_amount=0 WHERE wallet_id='w'")).rejects.toThrow('RESERVATION_COUNTER_MANAGED');
  await expect(db.exec("UPDATE intent_wallets SET currency='EUR' WHERE wallet_id='w'")).rejects.toThrow('WALLET_FINANCIAL_CURRENCY_IMMUTABLE');
 });
 it('reserves exact bound FX wallet amount rather than the smaller presentment amount',async()=>{
  await db.exec("UPDATE intent_wallets SET currency='INR',total_authority=10000,max_single_transaction=10000,auto_buy_limit=10000 WHERE wallet_id='w'");
  await db.query('UPDATE purchase_sessions SET selected_product=$1::jsonb WHERE session_id=$2',[JSON.stringify({price:49,currency:'USD',authorizationContext:{walletAmount:4091.5,walletCurrency:'INR'}}),'s1']);
  await reserve('s1',4091.5,'INR');expect(Number((await snapshot()).reserved_amount)).toBe(4091.5);
  await expect(reserve('s2',70,'USD')).rejects.toThrow('RESERVATION_AMOUNT_INVALID');
 });
 it('refuses new reservations beside an unaccounted historical payment',async()=>{
  await db.query(`INSERT INTO session_payment_links(session_id,wallet_id,quote_hash,idempotency_key,provider,amount,currency) VALUES('s2','w',$1,'historical','paypal',70,'USD')`,[quote]);
  await expect(reserve()).rejects.toThrow('LEGACY_PAYMENT_RECONCILIATION_REQUIRED');
 });
 it('STEP-UP approval races cannot create more wallet authority than is available',async()=>{
  await db.exec(`UPDATE intent_wallets SET auto_buy_limit=50 WHERE wallet_id='w';
   INSERT INTO wallet_step_up_requests(request_id,wallet_id,transaction_payload,quote_hash,requested_amount,current_auto_buy_limit,additional_authority_required,expires_at)
   VALUES('step','w','{}','${quote}',70,50,20,NOW()+INTERVAL '1 hour');
   UPDATE purchase_sessions SET status='AWAITING_STEP_UP',step_up_request_id='step',selected_decision='STEP_UP' WHERE session_id='s1';`);
  const results=await Promise.all(['APPROVED_ONCE','REJECTED','LIMIT_RAISED'].map(status=>db.query(RESOLVE_STEP_UP_SQL,['step','w',status,'{}',quote,'once-'+status,'token-'+status,new Date(Date.now()+600000).toISOString()])));
  expect(results.filter(r=>r.rows.length)).toHaveLength(1);
  const s=(await db.query<any>("SELECT status FROM purchase_sessions WHERE session_id='s1'")).rows[0];
  if(s.status==='READY_TO_PAY')await reserve();else await expect(reserve()).rejects.toThrow('RESERVATION_SESSION_NOT_READY');
  if(s.status==='READY_TO_PAY')await expect(reserve('s2')).rejects.toThrow('WALLET_AVAILABLE_AUTHORITY_EXCEEDED');
  else {await reserve('s2');expect(Number((await snapshot()).reserved_amount)).toBe(70);}
 });
});

describe('additive migration compatibility and transactional rollback',()=>{
 async function historicalDatabase(duplicate=false){
  const isolated=await isolatedDatabase();
  for(const file of ['v10_1_intent_wallets.sql','v10_2_step_up.sql','v10_4_purchase_sessions.sql','v10_6_payment_proof.sql','v11_0_paypal_provider.sql','v11_0_1_multi_currency.sql','v11_0_2_capture_retry.sql','v11_0_3_late_capture.sql'])await isolated.exec(readFileSync(new URL('../../db/'+file,import.meta.url),'utf8'));
  await isolated.exec(`INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,spent_amount,auto_buy_limit,max_single_transaction,valid_until,status) VALUES('old','historical','USD',100,70,75,75,NOW()-INTERVAL '1 day','REVOKED');
   INSERT INTO purchase_sessions(session_id,wallet_id,user_prompt,status) VALUES('old-s','old','historical','CAPTURED');
   INSERT INTO wallet_spend_ledger(session_id,wallet_id,amount,currency,provider,provider_link_id,provider_payment_id) VALUES('old-s','old',70,'USD','paypal','old-order','old-capture');`);
  if(duplicate)await isolated.exec(`INSERT INTO purchase_sessions(session_id,wallet_id,user_prompt,status) VALUES('duplicate-s','old','historical','CAPTURED');INSERT INTO wallet_spend_ledger(session_id,wallet_id,amount,currency,provider,provider_link_id,provider_payment_id) VALUES('duplicate-s','old',1,'USD','paypal','another-order','old-capture')`);
  return isolated;
 }
 it('does not rewrite historical paid sessions, ledger rows or revoked wallet spend',async()=>{
  const isolated=await historicalDatabase();try{
   const prior=(await isolated.query('SELECT * FROM wallet_spend_ledger')).rows;
   await isolated.exec(readFileSync(new URL('../../db/v11_4_5_wallet_reservations.sql',import.meta.url),'utf8'));
   expect((await isolated.query('SELECT * FROM wallet_spend_ledger')).rows).toEqual(prior);
   expect((await isolated.query<any>('SELECT status,spent_amount::text,reserved_amount::text FROM intent_wallets')).rows[0]).toEqual({status:'REVOKED',spent_amount:'70.00',reserved_amount:'0'});
   expect((await isolated.query('SELECT * FROM wallet_authority_reservations')).rows).toHaveLength(0);
  }finally{await isolated.close();}
 },30000);
 it('rolls back the entire migration when historical capture identities conflict',async()=>{
  const isolated=await historicalDatabase(true);try{
   await expect(isolated.exec(readFileSync(new URL('../../db/v11_4_5_wallet_reservations.sql',import.meta.url),'utf8'))).rejects.toThrow();await isolated.exec('ROLLBACK');
   expect((await isolated.query("SELECT column_name FROM information_schema.columns WHERE table_name='intent_wallets' AND column_name='reserved_amount'")).rows).toHaveLength(0);
   expect((await isolated.query('SELECT * FROM wallet_spend_ledger')).rows).toHaveLength(2);
  }finally{await isolated.close();}
 },30000);
});
