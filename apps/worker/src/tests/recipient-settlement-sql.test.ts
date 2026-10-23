import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {isolatedDatabase,type IsolatedDatabase} from './isolated-database';
import {readFileSync} from 'node:fs';
import {syntheticBinding,syntheticEnv,syntheticMerchant,otherSyntheticMerchant} from './recipient-fixtures';
import {verifyProviderRecipient,getRecipientSettlement,recordRecipientObservation} from '../session-payments/recipient-evidence';
import {reserveWalletAuthority,beginProviderOperation,confirmProviderOperation,releaseUnusedReservation} from '../session-payments/reservations';
import {reserveSessionPayment,persistSessionPaymentCheckout,markSessionPaymentPending,markPayPalAuthorized,markPayPalCaptureRequested,getSessionPayment,claimSessionWebhook,applyWalletSpendOnce} from '../session-payments/repository';
import {getPayPalRecipientFacts} from '../session-payments/providers/paypal';
let db:IsolatedDatabase,binding:any,raw:any,payment:any,webhook:any;
const env={...syntheticEnv,DATABASE_URL:'isolated'};
const quote='a'.repeat(64);
vi.mock('@neondatabase/serverless',()=>({neon:()=>{
 const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{let query=parts[0];for(let i=0;i<values.length;i++)query+='$'+(i+1)+parts[i+1];return (await db.query(query,values)).rows;};
 sql.query=async(query:string,values:unknown[])=> (await db.query(query,values)).rows;return sql;
}}));
vi.mock('../session-payments/providers/paypal',async original=>({...await original<typeof import('../session-payments/providers/paypal')>(),getPayPalRecipientFacts:vi.fn()}));
beforeAll(async()=>{
 db=await isolatedDatabase();for(const file of ['v10_1_intent_wallets.sql','v10_2_step_up.sql','v10_4_purchase_sessions.sql','v10_6_payment_proof.sql','v11_0_paypal_provider.sql','v11_0_1_multi_currency.sql','v11_0_2_capture_retry.sql','v11_0_3_late_capture.sql','v11_4_5_wallet_reservations.sql','v11_4_6_verified_recipient.sql'])await db.exec(readFileSync(new URL('../../db/'+file,import.meta.url),'utf8'));
 binding=await syntheticBinding();
},30000);
beforeEach(async()=>{
 vi.resetAllMocks();await db.exec(`TRUNCATE intent_wallets CASCADE;
 INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,auto_buy_limit,max_single_transaction,valid_until) VALUES('w','test','USD',100,100,100,NOW()+INTERVAL '1 day');`);
 const selected={id:'product',price:49,currency:'USD',authorizationContext:{walletAmount:49,walletCurrency:'USD',recipient:binding}};
 await db.query(`INSERT INTO purchase_sessions(session_id,wallet_id,user_prompt,status,selected_product,selected_decision) VALUES('s','w','test','READY_TO_PAY',$1::jsonb,'ALLOW')`,[JSON.stringify(selected)]);
 raw={order:{id:'order',intent:'AUTHORIZE',status:'CREATED',purchase_units:[{reference_id:'s',custom_id:'s',payee:{merchant_id:syntheticMerchant},amount:{value:'49.00',currency_code:'USD'},payments:{authorizations:[],captures:[]}}]},authorization:null,capture:null};
 webhook={event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'capture',status:'COMPLETED',amount:{value:'49.00',currency_code:'USD'},supplementary_data:{related_ids:{order_id:'order',authorization_id:'auth'}}}};
 vi.mocked(getPayPalRecipientFacts).mockImplementation(async()=>structuredClone(raw));
 await reserveWalletAuthority('isolated',{sessionId:'s',walletId:'w',amount:49,currency:'USD',quoteHash:quote,idempotencyKey:'key',provider:'paypal'});
 await reserveSessionPayment('isolated',{sessionId:'s',walletId:'w',authorizationId:null,quoteHash:quote,idempotencyKey:'key',amount:49,currency:'USD',provider:'paypal',expectedRecipient:binding});
 await beginProviderOperation('isolated','s',quote,'CHECKOUT');
 payment=await persistSessionPaymentCheckout('isolated',{sessionId:'s',walletId:'w',authorizationId:null,quoteHash:quote,idempotencyKey:'key',provider:'paypal',providerOrderId:'order',referenceId:'s',checkoutUrl:'https://provider.invalid/approval',amount:49,currency:'USD',status:'CREATED',expiresAt:'2099-01-01T00:00:00Z',expectedRecipient:binding});
 await markSessionPaymentPending('isolated',{sessionId:'s',provider:'paypal',quoteHash:quote,idempotencyKey:'key',providerOrderId:'order',checkoutUrl:'https://provider.invalid/approval',status:'PAYPAL_APPROVAL_PENDING'});
});
afterAll(async()=>{await db?.close();});
async function order(){await verifyProviderRecipient(env,payment,'ORDER');await confirmProviderOperation('isolated','s','CHECKOUT','order');raw.order.status='APPROVED';}
async function authorized(){
 await order();await verifyProviderRecipient(env,payment,'PRE_AUTHORIZE');await beginProviderOperation('isolated','s',quote,'AUTHORIZE');
 raw.authorization={id:'auth',status:'CREATED',amount:{value:'49.00',currency_code:'USD'}};raw.order.purchase_units[0].payments.authorizations=[structuredClone(raw.authorization)];
 raw.order.status='COMPLETED';
 await verifyProviderRecipient(env,payment,'AUTHORIZE',{authorizationId:'auth'});
 await markPayPalAuthorized('isolated',{sessionId:'s',providerOrderId:'order',providerAuthorizationId:'auth',status:'AUTHORIZED'});await confirmProviderOperation('isolated','s','AUTHORIZE','order','auth');payment=await getSessionPayment('isolated','s');
}
async function captured(){
 await authorized();await verifyProviderRecipient(env,payment,'PRE_CAPTURE');await beginProviderOperation('isolated','s',quote,'CAPTURE');
 raw.capture=structuredClone(webhook.resource);raw.order.purchase_units[0].payments.captures=[structuredClone(raw.capture)];
 await markPayPalCaptureRequested('isolated',{sessionId:'s',providerCaptureId:'capture',status:'CAPTURE_REQUESTED'});payment=await getSessionPayment('isolated','s');
 await claimSessionWebhook('isolated',{payloadHash:'verified-hash',eventType:'PAYMENT.CAPTURE.COMPLETED',provider:'paypal',providerLinkId:'order',providerPaymentId:'capture',sessionId:'s',payload:webhook});
}
const settle=()=>applyWalletSpendOnce('isolated',{sessionId:'s',walletId:'w',amount:49,currency:'USD',provider:'paypal',providerLinkId:'order',providerPaymentId:'capture',verifiedPayPalPayloadHash:'verified-hash'});
const wallet=async()=> (await db.query<any>("SELECT spent_amount::text,reserved_amount::text FROM intent_wallets WHERE wallet_id='w'")).rows[0];
describe('recipient verification against actual PostgreSQL payment and reservation state',()=>{
 it('settles exact provider recipient evidence and twenty replayed deliveries once',async()=>{
  await captured();await verifyProviderRecipient(env,payment,'SETTLEMENT',{payloadHash:'verified-hash',webhook});
  const results=await Promise.all(Array.from({length:20},settle));expect(results.filter(r=>r.applied)).toHaveLength(1);expect(await wallet()).toEqual({spent_amount:'49.00',reserved_amount:'0'});
  expect((await getRecipientSettlement('isolated','s'))?.actual_merchant_id).toBe(syntheticMerchant);
 });
 it('does not settle a successful API capture without verified recipient evidence',async()=>{
  await captured();await expect(settle()).rejects.toThrow('VERIFIED_PROVIDER_RECIPIENT_REQUIRED');expect((await wallet()).reserved_amount).toBe('49');
 });
 it('rejects a missing order payee and preserves the raw observation',async()=>{
  delete raw.order.purchase_units[0].payee;await expect(verifyProviderRecipient(env,payment,'ORDER')).rejects.toThrow('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');
  const observations=(await db.query<any>('SELECT verified,raw FROM paypal_recipient_observations')).rows;expect(observations).toHaveLength(1);expect(observations[0].verified).toBe(false);expect(observations[0].raw.order.purchase_units[0].payee).toBeUndefined();
  expect(await releaseUnusedReservation('isolated','s',true)).toBe(false);
 });
 it('rejects order payee substitution after approval and holds the active reservation',async()=>{
  await authorized();raw.order.purchase_units[0].payee.merchant_id=otherSyntheticMerchant;
  await expect(verifyProviderRecipient(env,payment,'PRE_CAPTURE')).rejects.toThrow('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');expect((await wallet()).reserved_amount).toBe('49');
  await expect(beginProviderOperation('isolated','s',quote,'CAPTURE')).rejects.toThrow();expect((await db.query('SELECT * FROM wallet_spend_ledger')).rows).toHaveLength(0);
 });
 it('rejects authorization payee contradictions even when the order payee matches',async()=>{
  await authorized();raw.authorization.payee={merchant_id:otherSyntheticMerchant};await expect(verifyProviderRecipient(env,payment,'PRE_CAPTURE')).rejects.toThrow('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');
 });
 it('rejects capture payee contradictions even when the order payee matches',async()=>{
  await captured();raw.capture.payee={merchant_id:otherSyntheticMerchant};await expect(verifyProviderRecipient(env,payment,'SETTLEMENT',{payloadHash:'verified-hash',webhook})).rejects.toThrow('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');await expect(settle()).rejects.toThrow();expect((await wallet()).spent_amount).toBe('0.00');
  raw.capture.payee={merchant_id:syntheticMerchant};await verifyProviderRecipient(env,payment,'SETTLEMENT',{payloadHash:'verified-hash',webhook});
  await expect(settle()).rejects.toThrow('PAYPAL_RECIPIENT_CONTRADICTION_REQUIRES_INVESTIGATION');expect((await wallet()).reserved_amount).toBe('49');
 });
 it('rejects a signed webhook recipient mismatch without changing trusted CAPTURED state',async()=>{
  await captured();webhook.resource.payee={merchant_id:otherSyntheticMerchant};await db.query('UPDATE session_payment_webhook_events SET payload=$1::jsonb',[JSON.stringify(webhook)]);
  await expect(verifyProviderRecipient(env,payment,'SETTLEMENT',{payloadHash:'verified-hash',webhook})).rejects.toThrow('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');expect((await wallet()).reserved_amount).toBe('49');
  expect((await db.query<any>('SELECT status FROM purchase_sessions')).rows[0].status).toBe('CAPTURE_PENDING');expect(await getRecipientSettlement('isolated','s')).toBeNull();
 });
 it('rejects a contradictory POST response despite matching subsequent GETs',async()=>{
  await expect(verifyProviderRecipient(env,payment,'ORDER',{providerResponse:{purchase_units:[{payee:{merchant_id:otherSyntheticMerchant}}]}})).rejects.toThrow('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');
 });
 it('does not grant authorization without a fresh verified provider recipient',async()=>{
  await order();await expect(beginProviderOperation('isolated','s',quote,'AUTHORIZE')).rejects.toThrow('VERIFIED_PROVIDER_RECIPIENT_REQUIRED');
 });
 it('rejects an authorization found on another order',async()=>{
  await authorized();raw.authorization.supplementary_data={related_ids:{order_id:'foreign-order'}};await expect(verifyProviderRecipient(env,payment,'PRE_CAPTURE')).rejects.toThrow('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');
 });
 it('never crosses sandbox/live environments or fetches the wrong environment',async()=>{
  await expect(verifyProviderRecipient({...env,PAYPAL_ENV:'live'},payment,'ORDER')).rejects.toThrow('PAYPAL_RECIPIENT_ENVIRONMENT_MISMATCH');expect(getPayPalRecipientFacts).not.toHaveBeenCalled();expect((await wallet()).reserved_amount).toBe('49');
 });
 it('holds authority across read timeouts and recovers idempotently using later provider truth',async()=>{
  await captured();vi.mocked(getPayPalRecipientFacts).mockRejectedValueOnce(new Error('timeout'));
  await expect(verifyProviderRecipient(env,payment,'SETTLEMENT',{payloadHash:'verified-hash',webhook})).rejects.toThrow('PAYPAL_RECIPIENT_PROVIDER_READ_FAILED');expect((await wallet()).reserved_amount).toBe('49');
  await verifyProviderRecipient(env,payment,'SETTLEMENT',{payloadHash:'verified-hash',webhook});expect((await settle()).applied).toBe(true);expect((await settle()).applied).toBe(false);
 });
 it('cannot manufacture verified evidence or mutate a previously verified snapshot',async()=>{
  raw.order.purchase_units[0].payee.merchant_id=otherSyntheticMerchant;
  await expect(db.query(`INSERT INTO paypal_recipient_observations(session_id,stage,environment,expected_fingerprint,order_id,raw,verified) VALUES('s','ORDER','sandbox',$1,'order',$2::jsonb,TRUE)`,[binding.fingerprint,JSON.stringify(raw)])).rejects.toThrow('RECIPIENT_EVIDENCE_INVALID');
  raw.order.purchase_units[0].payee.merchant_id=syntheticMerchant;await verifyProviderRecipient(env,payment,'ORDER');await expect(db.exec("UPDATE paypal_recipient_observations SET raw='{}'")).rejects.toThrow('RECIPIENT_EVIDENCE_IMMUTABLE');
 });
 it('does not let a browser state or forged owner substitute a payment binding',async()=>{
  await expect(db.query('UPDATE session_payment_links SET expected_recipient=$1::jsonb',[JSON.stringify({...binding,paypalMerchantId:otherSyntheticMerchant})])).rejects.toThrow('RECIPIENT_BINDING_IMMUTABLE');
 });
 it('keeps an out-of-order mismatch from undoing a committed debit',async()=>{
  await captured();await verifyProviderRecipient(env,payment,'SETTLEMENT',{payloadHash:'verified-hash',webhook});await settle();
  raw.order.purchase_units[0].payee.merchant_id=otherSyntheticMerchant;await expect(verifyProviderRecipient(env,payment,'SETTLEMENT',{payloadHash:'verified-hash',webhook})).rejects.toThrow();expect((await wallet()).spent_amount).toBe('49.00');expect((await wallet()).reserved_amount).toBe('0');
  expect(await getRecipientSettlement('isolated','s')).toBeNull();
 });
 it('fails closed when the recipient evidence schema is unavailable',async()=>{
  await db.exec('BEGIN; ALTER TABLE paypal_recipient_observations RENAME TO temporarily_unavailable_recipient_observations');
  try{await expect(verifyProviderRecipient(env,payment,'ORDER')).rejects.toThrow();}finally{await db.exec('ROLLBACK');}
  expect((await wallet()).reserved_amount).toBe('49');expect((await db.query('SELECT * FROM wallet_spend_ledger')).rows).toHaveLength(0);
 });
 it('recovers a known checkout after a provider read timeout without creating another order',async()=>{
  vi.mocked(getPayPalRecipientFacts).mockRejectedValueOnce(new Error('timeout'));
  await expect(verifyProviderRecipient(env,payment,'ORDER')).rejects.toThrow('PAYPAL_RECIPIENT_PROVIDER_READ_FAILED');
  const {reconcileWalletReservation}=await import('../session-payments/reservations');
  expect(await reconcileWalletReservation(env,'s')).toMatchObject({recoveredCheckout:true,released:false,state:'RESERVED'});
  expect((await wallet()).reserved_amount).toBe('49');
 });
 it('keeps recipient identity fixed while settling the exact different wallet currency amount',async()=>{
  const selected={id:'fx-product',price:49,currency:'USD',authorizationContext:{walletAmount:4091.5,walletCurrency:'INR',recipient:binding}};
  await db.exec("INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,auto_buy_limit,max_single_transaction,valid_until) VALUES('fxw','fx','INR',10000,10000,10000,NOW()+INTERVAL '1 day')");
  await db.query("INSERT INTO purchase_sessions(session_id,wallet_id,user_prompt,status,selected_product,selected_decision) VALUES('fx','fxw','fx','READY_TO_PAY',$1::jsonb,'ALLOW')",[JSON.stringify(selected)]);
  const fxQuote='b'.repeat(64);
  await reserveWalletAuthority('isolated',{sessionId:'fx',walletId:'fxw',amount:4091.5,currency:'INR',quoteHash:fxQuote,idempotencyKey:'fx-key',provider:'paypal'});
  const input={sessionId:'fx',walletId:'fxw',authorizationId:null,quoteHash:fxQuote,idempotencyKey:'fx-key',amount:49,currency:'USD',provider:'paypal' as const,expectedRecipient:binding};
  await reserveSessionPayment('isolated',input);await beginProviderOperation('isolated','fx',fxQuote,'CHECKOUT');
  let fp=await persistSessionPaymentCheckout('isolated',{...input,providerOrderId:'fx-order',referenceId:'fx',checkoutUrl:'https://provider.invalid/fx',status:'CREATED',expiresAt:'2099-01-01T00:00:00Z'});
  await markSessionPaymentPending('isolated',{sessionId:'fx',provider:'paypal',quoteHash:fxQuote,idempotencyKey:'fx-key',providerOrderId:'fx-order',checkoutUrl:'https://provider.invalid/fx',status:'PAYPAL_APPROVAL_PENDING'});
  raw.order.id='fx-order';raw.order.purchase_units[0].custom_id='fx';raw.order.purchase_units[0].reference_id='fx';
  await verifyProviderRecipient(env,fp,'ORDER');await confirmProviderOperation('isolated','fx','CHECKOUT','fx-order');raw.order.status='APPROVED';
  await verifyProviderRecipient(env,fp,'PRE_AUTHORIZE');await beginProviderOperation('isolated','fx',fxQuote,'AUTHORIZE');
  raw.authorization={id:'fx-auth',status:'CREATED',amount:{value:'49.00',currency_code:'USD'}};raw.order.purchase_units[0].payments.authorizations=[structuredClone(raw.authorization)];raw.order.status='COMPLETED';
  await verifyProviderRecipient(env,fp,'AUTHORIZE',{authorizationId:'fx-auth'});await markPayPalAuthorized('isolated',{sessionId:'fx',providerOrderId:'fx-order',providerAuthorizationId:'fx-auth',status:'AUTHORIZED'});await confirmProviderOperation('isolated','fx','AUTHORIZE','fx-order','fx-auth');fp=(await getSessionPayment('isolated','fx'))!;
  await verifyProviderRecipient(env,fp,'PRE_CAPTURE');await beginProviderOperation('isolated','fx',fxQuote,'CAPTURE');
  raw.capture={id:'fx-capture',status:'COMPLETED',amount:{value:'49.00',currency_code:'USD'},supplementary_data:{related_ids:{order_id:'fx-order',authorization_id:'fx-auth'}}};raw.order.purchase_units[0].payments.captures=[structuredClone(raw.capture)];
  const event={event_type:'PAYMENT.CAPTURE.COMPLETED',resource:structuredClone(raw.capture)};
  await claimSessionWebhook('isolated',{payloadHash:'fx-evidence',eventType:'PAYMENT.CAPTURE.COMPLETED',provider:'paypal',providerLinkId:'fx-order',providerPaymentId:'fx-capture',sessionId:'fx',payload:event});
  await verifyProviderRecipient(env,fp,'SETTLEMENT',{payloadHash:'fx-evidence',webhook:event,captureId:'fx-capture'});
  const result=await applyWalletSpendOnce('isolated',{sessionId:'fx',walletId:'fxw',amount:4091.5,currency:'INR',provider:'paypal',providerLinkId:'fx-order',providerPaymentId:'fx-capture',verifiedPayPalPayloadHash:'fx-evidence'});
  expect(result.spentAmount).toBe(4091.5);expect((await getRecipientSettlement('isolated','fx'))?.actual_merchant_id).toBe(syntheticMerchant);
 });
});

it('adds recipient schema without rewriting a historical successful capture or its evidence',async()=>{
 const isolated=await isolatedDatabase();try{
  for(const file of ['v10_1_intent_wallets.sql','v10_2_step_up.sql','v10_4_purchase_sessions.sql','v10_6_payment_proof.sql','v11_0_paypal_provider.sql','v11_0_1_multi_currency.sql','v11_0_2_capture_retry.sql','v11_0_3_late_capture.sql','v11_4_5_wallet_reservations.sql'])await isolated.exec(readFileSync(new URL('../../db/'+file,import.meta.url),'utf8'));
  await isolated.exec(`INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,spent_amount,auto_buy_limit,max_single_transaction,valid_until) VALUES('old-wallet','historical','USD',100,49,100,100,NOW()-INTERVAL '1 day');
   INSERT INTO purchase_sessions(session_id,wallet_id,user_prompt,status,payment_provider,provider_order_id,provider_capture_id) VALUES('old-session','old-wallet','old','CAPTURED','paypal','old-order','old-capture');
   INSERT INTO session_payment_links(session_id,wallet_id,quote_hash,idempotency_key,provider,provider_order_id,provider_capture_id,amount,currency,status) VALUES('old-session','old-wallet','${quote}','old-key','paypal','old-order','old-capture',49,'USD','COMPLETED');
   INSERT INTO wallet_spend_ledger(session_id,wallet_id,amount,currency,provider,provider_link_id,provider_payment_id) VALUES('old-session','old-wallet',49,'USD','paypal','old-order','old-capture');`);
  const prior=(await isolated.query('SELECT * FROM wallet_spend_ledger')).rows;
  await isolated.exec(readFileSync(new URL('../../db/v11_4_6_verified_recipient.sql',import.meta.url),'utf8'));
  expect((await isolated.query('SELECT * FROM wallet_spend_ledger')).rows).toEqual(prior);
  expect((await isolated.query<any>('SELECT expected_recipient,status FROM session_payment_links')).rows[0]).toEqual({expected_recipient:null,status:'COMPLETED'});
  expect((await isolated.query('SELECT * FROM paypal_recipient_observations')).rows).toHaveLength(0);
 }finally{await isolated.close();}
},30000);
