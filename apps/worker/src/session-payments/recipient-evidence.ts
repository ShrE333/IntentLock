import {neon} from '@neondatabase/serverless';
import {getPayPalRecipientFacts,type PayPalEnv} from './providers/paypal';
import {recipientEnvironment,type RecipientBinding} from '../payments/recipient-binding';
import type {SessionPaymentRecord} from './types';
export type RecipientStage='ORDER'|'PRE_AUTHORIZE'|'AUTHORIZE'|'PRE_CAPTURE'|'CAPTURE'|'SETTLEMENT'|'RECOVERY';
export async function quarantineRecipient(db:string,sessionId:string){
 await neon(db).query(`WITH wallet AS MATERIALIZED (SELECT w.wallet_id FROM intent_wallets w JOIN wallet_authority_reservations r ON r.wallet_id=w.wallet_id WHERE r.session_id=$1 FOR UPDATE OF w)
 UPDATE wallet_authority_reservations r SET state='RECONCILIATION_REQUIRED' FROM wallet w WHERE r.session_id=$1 AND r.wallet_id=w.wallet_id AND r.state='RESERVED'`,[sessionId]);
}
export async function recordRecipientObservation(db:string,payment:SessionPaymentRecord,stage:RecipientStage,environment:string,raw:unknown,payloadHash?:string,authorizationId?:string|null,captureId?:string|null){
 const b=payment.expectedRecipient;
 if(!b)throw new Error('VERIFIED_RECIPIENT_MAPPING_REQUIRED');
 const sql=neon(db);
 const rows=await sql.query(`INSERT INTO paypal_recipient_observations(session_id,stage,environment,expected_fingerprint,order_id,authorization_id,capture_id,payload_hash,raw)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING observation_id`,[payment.sessionId,stage,environment,b.fingerprint,payment.providerOrderId,authorizationId??payment.providerAuthorizationId,captureId??payment.providerCaptureId,payloadHash??null,JSON.stringify(raw)]);
 const id=String(rows[0].observation_id);
 const checked=await sql.query(`UPDATE paypal_recipient_observations o SET verified=TRUE WHERE observation_id=$1 AND recipient_observation_valid_v11_4_6(o) RETURNING observation_id`,[id]);
 if(checked.length!==1){await quarantineRecipient(db,payment.sessionId);throw new Error('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');}
 return id;
}
export async function verifyProviderRecipient(env:PayPalEnv & {DATABASE_URL?:string},payment:SessionPaymentRecord,stage:RecipientStage,options:{payloadHash?:string;webhook?:unknown;authorizationId?:string|null;captureId?:string|null;providerResponse?:unknown}={}){
 if(!env.DATABASE_URL)throw new Error('DATABASE_NOT_CONFIGURED');
 if(!payment.expectedRecipient)throw new Error('VERIFIED_RECIPIENT_MAPPING_REQUIRED');
 const environment=recipientEnvironment(env);
 if(environment!==payment.expectedRecipient.environment){await quarantineRecipient(env.DATABASE_URL,payment.sessionId);throw new Error('PAYPAL_RECIPIENT_ENVIRONMENT_MISMATCH');}
 let raw:unknown;
 try{raw={...await getPayPalRecipientFacts(env,payment.providerOrderId!,options.authorizationId??payment.providerAuthorizationId,options.captureId??payment.providerCaptureId),...(options.webhook?{webhook:options.webhook}:{}),...(options.providerResponse?{apiResponse:options.providerResponse}:{})};}
 catch{
  // Persist the failed read as unverified evidence without leaking OAuth errors.
  await neon(env.DATABASE_URL).query(`INSERT INTO paypal_recipient_observations(session_id,stage,environment,expected_fingerprint,order_id,authorization_id,capture_id,payload_hash,raw)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,[payment.sessionId,stage,environment,payment.expectedRecipient.fingerprint,payment.providerOrderId,options.authorizationId??payment.providerAuthorizationId,options.captureId??payment.providerCaptureId,options.payloadHash??null,JSON.stringify({error:'PROVIDER_READ_FAILED',...(options.providerResponse?{apiResponse:options.providerResponse}:{})})]);
  await quarantineRecipient(env.DATABASE_URL,payment.sessionId);throw new Error('PAYPAL_RECIPIENT_PROVIDER_READ_FAILED');
 }
 return recordRecipientObservation(env.DATABASE_URL,payment,stage,environment,raw,options.payloadHash,options.authorizationId,options.captureId);
}
export async function getRecipientSettlement(db:string,sessionId:string){
 const rows=await neon(db).query(`SELECT o.observation_id,o.expected_fingerprint,o.environment,o.order_id,o.authorization_id,o.capture_id,
 p.expected_recipient,p.wallet_id,o.raw #>> '{order,purchase_units,0,payee,merchant_id}' AS actual_merchant_id
 FROM paypal_recipient_observations o JOIN session_payment_links p ON p.session_id=o.session_id
 WHERE o.session_id=$1 AND o.stage='SETTLEMENT' AND o.verified AND recipient_observation_valid_v11_4_6(o)
 AND NOT EXISTS(SELECT 1 FROM paypal_recipient_observations x WHERE x.session_id=o.session_id AND x.recipient_contradiction)
 ORDER BY o.created_at,o.observation_id LIMIT 1`,[sessionId]);
 return rows[0]??null;
}
export function recipientProof(binding:RecipientBinding,evidence:any){
 return {status:'VERIFIED',environment:binding.environment,sandbox:binding.environment==='sandbox',expected:binding,
 actualMerchantId:evidence.actual_merchant_id,evidenceId:String(evidence.observation_id),evidenceFingerprint:evidence.expected_fingerprint,merchantFulfillmentVerified:false};
}
