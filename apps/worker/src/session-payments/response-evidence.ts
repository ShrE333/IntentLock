import {neon} from '@neondatabase/serverless';
import type {SessionPaymentRecord} from './types';
import {recipientEnvironment,type RecipientEnv} from '../payments/recipient-binding';
// Persist authenticated API response bodies before parsing required fields. These
// rows are observations, never verified recipient or settlement evidence.
export async function recordPayPalResponse(env:RecipientEnv & {DATABASE_URL?:string},payment:SessionPaymentRecord,stage:'ORDER'|'AUTHORIZE'|'CAPTURE',raw:unknown){
 if(!env.DATABASE_URL||!payment.expectedRecipient)throw new Error('VERIFIED_RECIPIENT_MAPPING_REQUIRED');
 const body=raw as any;
 const orderId=payment.providerOrderId??(typeof body?.id==='string'?body.id:'UNRESOLVED');
 await neon(env.DATABASE_URL).query(`INSERT INTO paypal_recipient_observations(session_id,stage,environment,expected_fingerprint,order_id,authorization_id,capture_id,raw)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[payment.sessionId,stage,recipientEnvironment(env),payment.expectedRecipient.fingerprint,orderId,payment.providerAuthorizationId,payment.providerCaptureId,JSON.stringify({apiResponse:raw})]);
}
