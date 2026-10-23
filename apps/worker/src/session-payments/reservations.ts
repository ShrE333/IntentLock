import {neon} from '@neondatabase/serverless';
import {validMoney} from '../wallets/validation';
import {getPayPalReservationTruth} from './providers/paypal';
import type {PayPalEnv} from './providers/paypal';
import {addEvent} from '../sessions/repository';
import {appendSessionAuditEvent} from './audit';
import {getSessionPayment} from './repository';
import {verifyProviderRecipient} from './recipient-evidence';

export async function reserveWalletAuthority(db:string,input:{sessionId:string;walletId:string;quoteHash:string;idempotencyKey:string;amount:number;currency:string;provider:string}){
 if(!validMoney(input.amount,input.currency))throw new Error('RESERVATION_AMOUNT_INVALID');
 const rows=await neon(db).query('SELECT * FROM reserve_wallet_authority_v11_4_5($1,$2,$3,$4,$5,$6,$7)',[
  input.sessionId,input.walletId,input.quoteHash,input.idempotencyKey,String(input.amount),input.currency,input.provider
 ]);
 if(rows.length!==1)throw new Error('RESERVATION_REQUIRED');
 return rows[0];
}
export async function beginProviderOperation(db:string,session:string,quote:string,phase:'CHECKOUT'|'AUTHORIZE'|'CAPTURE'){
 const rows=await neon(db).query('SELECT * FROM begin_wallet_provider_operation_v11_4_5($1,$2,$3)',[session,quote,phase]);
 if(rows.length!==1)throw new Error('RESERVATION_REQUIRED');
 return rows[0];
}
export async function confirmProviderOperation(db:string,session:string,phase:string,order:string|null,authorization:string|null=null,capture:string|null=null){
 await neon(db).query('SELECT confirm_wallet_provider_operation_v11_4_5($1,$2,$3,$4,$5)',[session,phase,order,authorization,capture]);
}
export async function releaseUnusedReservation(db:string,session:string,expire=false){
 const rows=await neon(db).query('SELECT release_unused_wallet_reservation_v11_4_5($1,$2) AS released',[session,expire]);
 return Boolean(rows[0]?.released);
}
export async function releaseVerifiedDeniedCapture(db:string,session:string,payloadHash:string){
 const rows=await neon(db).query('SELECT release_denied_wallet_capture_v11_4_5($1,$2) AS released',[session,payloadHash]);
 return Boolean(rows[0]?.released);
}
export async function getWalletReservation(db:string,session:string){
 const rows=await neon(db).query(`SELECT reservation_id,session_id,wallet_id,amount::text,currency,state,phase,
 provider_order_id,provider_authorization_id,provider_capture_id,expires_at FROM wallet_authority_reservations WHERE session_id=$1`,[session]);
 return rows[0]??null;
}
// Operator entry point only. GETs verify provider truth; they never void/capture.
// A capture ambiguity remains locked until independently verified settlement.
export async function reconcileWalletReservation(env:PayPalEnv & {DATABASE_URL:string},session:string):Promise<{state:string;released:boolean;recoveredAuthorization?:boolean;recoveredCheckout?:boolean;reconciliationRequired?:boolean}>{
 const sql=neon(env.DATABASE_URL);
 const rows=await sql.query('SELECT * FROM wallet_authority_reservations WHERE session_id=$1',[session]);
 const r=rows[0];if(!r)return {state:'HISTORICAL',released:false};
 if(['COMMITTED','RELEASED','EXPIRED'].includes(String(r.state)))return {state:r.state,released:false};
 if(await releaseUnusedReservation(env.DATABASE_URL,session,true))return {state:'EXPIRED',released:true};
 const persistedPayment=await getSessionPayment(env.DATABASE_URL,session);
 if(r.provider==='paypal'&&r.state==='RECONCILIATION_REQUIRED'&&r.phase==='CHECKOUT'&&persistedPayment?.expectedRecipient&&persistedPayment.providerOrderId){
  await verifyProviderRecipient(env,persistedPayment,'ORDER');
  await confirmProviderOperation(env.DATABASE_URL,session,'CHECKOUT',persistedPayment.providerOrderId);
  if(await releaseUnusedReservation(env.DATABASE_URL,session,true))return {state:'EXPIRED',released:true};
  return {state:'RESERVED',released:false,recoveredCheckout:true};
 }
 let recoveredAuthorization=false;
 if(r.provider==='paypal'&&['RESERVED','RECONCILIATION_REQUIRED'].includes(String(r.state))&&r.phase==='AUTHORIZE'&&r.provider_order_id){
  const truth=await getPayPalReservationTruth(env,String(r.provider_order_id),r.provider_authorization_id?String(r.provider_authorization_id):undefined);
  const payment=await getSessionPayment(env.DATABASE_URL,session);
  if(payment?.expectedRecipient)await verifyProviderRecipient(env,payment,'RECOVERY',{authorizationId:truth.authorization?.id});
  if(r.state==='RECONCILIATION_REQUIRED'){
   const recovered=await sql.query('SELECT recover_wallet_authorization_v11_4_5($1,$2::jsonb,$3::jsonb) AS recovered',[session,JSON.stringify(truth.order),JSON.stringify(truth.authorization)]);
   if(recovered[0]?.recovered){
    const facts={providerOrderId:r.provider_order_id,providerAuthorizationId:truth.authorization.id,source:'authenticated-provider-read'};
    await addEvent(env.DATABASE_URL,session,'PAYPAL_AUTHORIZATION_RECOVERED',facts);
    await appendSessionAuditEvent(env.DATABASE_URL,session,'PAYPAL_AUTHORIZATION_RECOVERED',facts);
    r.state='RESERVED';
    recoveredAuthorization=true;
   }
  }
  if(r.state!=='RESERVED')return {state:r.state,released:false,reconciliationRequired:true};
  const result=await sql.query('SELECT release_voided_wallet_reservation_v11_4_5($1,$2::jsonb,$3::jsonb) AS released',[session,JSON.stringify(truth.order),JSON.stringify(truth.authorization)]);
  if(result[0]?.released)return {state:'RELEASED',released:true};
 }
 return {state:r.state,released:false,recoveredAuthorization,reconciliationRequired:!recoveredAuthorization};
}
