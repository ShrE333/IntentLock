import {neon} from "@neondatabase/serverless";
import type {SessionPaymentRecord,ProofReceipt} from "./types";
import type {PaymentProviderName} from "./providers/types";

function iso(v:unknown){return v?new Date(String(v)).toISOString():null;}
function nullable(v:unknown){return v==null?null:String(v);}

function mapPayment(r:any):SessionPaymentRecord{
  return {
    sessionId:String(r.session_id),
    walletId:String(r.wallet_id),
    quoteHash:String(r.quote_hash),
    idempotencyKey:String(r.idempotency_key),
    provider:String(r.provider??"razorpay") as PaymentProviderName,
    providerOrderId:nullable(r.provider_order_id??r.provider_link_id),
    providerAuthorizationId:nullable(r.provider_authorization_id),
    providerCaptureId:nullable(r.provider_capture_id??r.provider_payment_id),
    referenceId:nullable(r.reference_id),
    checkoutUrl:nullable(r.checkout_url??r.short_url),
    amount:Number(r.amount),
    currency:String(r.currency).toUpperCase(),
    status:String(r.status),
    expiresAt:iso(r.expires_at),
    capturedAt:iso(r.captured_at)
  };
}

export async function getSessionPayment(db:string,sessionId:string){
  const rows=await neon(db)`
    SELECT * FROM session_payment_links
    WHERE session_id=${sessionId}
    LIMIT 1
  `;
  return rows.length?mapPayment(rows[0]):null;
}

export const getSessionPaymentLink=getSessionPayment;

export async function getSessionPaymentByProviderOrderId(db:string,providerOrderId:string){
  const rows=await neon(db)`
    SELECT * FROM session_payment_links
    WHERE provider_order_id=${providerOrderId}
       OR provider_link_id=${providerOrderId}
    LIMIT 1
  `;
  return rows.length?mapPayment(rows[0]):null;
}

export const getSessionPaymentLinkByProviderId=getSessionPaymentByProviderOrderId;

export async function getSessionPaymentByCaptureId(db:string,captureId:string){
  const rows=await neon(db)`
    SELECT * FROM session_payment_links
    WHERE provider_capture_id=${captureId}
       OR provider_payment_id=${captureId}
    LIMIT 1
  `;
  return rows.length?mapPayment(rows[0]):null;
}

export async function reserveSessionPayment(db:string,input:{
  sessionId:string;
  walletId:string;
  authorizationId:string|null;
  quoteHash:string;
  idempotencyKey:string;
  amount:number;
  currency:string;
  provider:PaymentProviderName;
}){
  const rows=await neon(db)`
    INSERT INTO session_payment_links(
      session_id,wallet_id,authorization_id,quote_hash,
      idempotency_key,amount,currency,status,provider
    ) VALUES(
      ${input.sessionId},${input.walletId},${input.authorizationId},
      ${input.quoteHash},${input.idempotencyKey},${input.amount},
      ${input.currency},'CREATING',${input.provider}
    )
    ON CONFLICT(session_id)
    DO UPDATE SET
      authorization_id=EXCLUDED.authorization_id,
      quote_hash=EXCLUDED.quote_hash,
      idempotency_key=EXCLUDED.idempotency_key,
      amount=EXCLUDED.amount,
      currency=EXCLUDED.currency,
      provider=EXCLUDED.provider,
      status=CASE
        WHEN session_payment_links.provider_order_id IS NULL
         AND session_payment_links.provider_link_id IS NULL
        THEN 'CREATING'
        ELSE session_payment_links.status
      END,
      updated_at=NOW()
    RETURNING session_id,provider_order_id,provider_link_id,status,provider
  `;

  const r:any=rows[0];
  return {
    sessionId:String(r.session_id),
    providerOrderId:nullable(r.provider_order_id??r.provider_link_id),
    status:String(r.status),
    provider:String(r.provider) as PaymentProviderName
  };
}

export async function markSessionPaymentCreationFailed(db:string,sessionId:string){
  await neon(db)`
    UPDATE session_payment_links
    SET status='FAILED',updated_at=NOW()
    WHERE session_id=${sessionId}
      AND provider_order_id IS NULL
      AND provider_link_id IS NULL
  `;
}

export async function persistSessionPaymentCheckout(db:string,input:{
  sessionId:string;
  walletId:string;
  authorizationId:string|null;
  quoteHash:string;
  idempotencyKey:string;
  provider:PaymentProviderName;
  providerOrderId:string;
  referenceId:string|null;
  checkoutUrl:string;
  amount:number;
  currency:string;
  status:string;
  expiresAt:string|null;
}){
  const legacyLinkId=input.provider==="razorpay"?input.providerOrderId:null;
  const legacyShortUrl=input.provider==="razorpay"?input.checkoutUrl:null;

  const rows=await neon(db)`
    INSERT INTO session_payment_links(
      session_id,wallet_id,authorization_id,quote_hash,idempotency_key,
      provider,provider_order_id,provider_link_id,reference_id,
      checkout_url,short_url,amount,currency,status,expires_at
    ) VALUES(
      ${input.sessionId},${input.walletId},${input.authorizationId},
      ${input.quoteHash},${input.idempotencyKey},${input.provider},
      ${input.providerOrderId},${legacyLinkId},${input.referenceId},
      ${input.checkoutUrl},${legacyShortUrl},${input.amount},${input.currency},
      ${input.status},${input.expiresAt}::timestamptz
    )
    ON CONFLICT(session_id)
    DO UPDATE SET
      authorization_id=EXCLUDED.authorization_id,
      quote_hash=EXCLUDED.quote_hash,
      idempotency_key=EXCLUDED.idempotency_key,
      provider=EXCLUDED.provider,
      provider_order_id=EXCLUDED.provider_order_id,
      provider_link_id=EXCLUDED.provider_link_id,
      reference_id=EXCLUDED.reference_id,
      checkout_url=EXCLUDED.checkout_url,
      short_url=EXCLUDED.short_url,
      amount=EXCLUDED.amount,
      currency=EXCLUDED.currency,
      status=EXCLUDED.status,
      expires_at=EXCLUDED.expires_at,
      updated_at=NOW()
    RETURNING *
  `;
  return mapPayment(rows[0]);
}

// Backwards-compatible name retained for old imports.
export const persistSessionPaymentLink=persistSessionPaymentCheckout;

export async function markSessionPaymentPending(db:string,input:{
  sessionId:string;
  provider:PaymentProviderName;
  quoteHash:string;
  idempotencyKey:string;
  providerOrderId:string;
  checkoutUrl:string;
  status:string;
}){
  await neon(db)`
    UPDATE purchase_sessions
    SET
      status=${input.status},
      quote_hash=${input.quoteHash},
      payment_idempotency_key=${input.idempotencyKey},
      payment_provider=${input.provider},
      provider_order_id=${input.providerOrderId},
      payment_link_url=${input.checkoutUrl},
      razorpay_payment_link_id=CASE WHEN ${input.provider}='razorpay' THEN ${input.providerOrderId} ELSE razorpay_payment_link_id END,
      updated_at=NOW()
    WHERE session_id=${input.sessionId}
  `;
}

export const updateSessionPaymentPending=markSessionPaymentPending;

export async function markPayPalAuthorized(db:string,input:{
  sessionId:string;
  providerOrderId:string;
  providerAuthorizationId:string;
  status:string;
}){
  await neon(db)`
    UPDATE session_payment_links
    SET provider_authorization_id=${input.providerAuthorizationId},
        status=${input.status},updated_at=NOW()
    WHERE session_id=${input.sessionId}
      AND provider='paypal'
      AND provider_order_id=${input.providerOrderId}
      AND status NOT IN ('CAPTURE_REQUESTED','COMPLETED')
  `;

  await neon(db)`
    UPDATE purchase_sessions
    SET status='AUTHORIZED',
        provider_authorization_id=${input.providerAuthorizationId},
        updated_at=NOW()
    WHERE session_id=${input.sessionId}
      AND status NOT IN ('CAPTURE_PENDING','CAPTURED')
  `;
}

export async function markPayPalCaptureRequested(db:string,input:{
  sessionId:string;
  providerCaptureId:string|null;
  status:string;
}){
  await neon(db)`
    UPDATE session_payment_links
    SET provider_capture_id=${input.providerCaptureId},
        provider_payment_id=${input.providerCaptureId},
        status=${input.status},updated_at=NOW()
    WHERE session_id=${input.sessionId}
      AND provider='paypal'
      AND status<>'COMPLETED'
  `;

  await neon(db)`
    UPDATE purchase_sessions
    SET status='CAPTURE_PENDING',
        provider_capture_id=${input.providerCaptureId},
        updated_at=NOW()
    WHERE session_id=${input.sessionId}
      AND status<>'CAPTURED'
  `;
}

export async function markSessionPaymentCaptured(db:string,input:{
  sessionId:string;
  provider:PaymentProviderName;
  providerOrderId:string;
  providerPaymentId:string|null;
  amount:number;
  currency:string;
}){
  await neon(db)`
    UPDATE session_payment_links
    SET
      status='COMPLETED',
      provider_capture_id=COALESCE(${input.providerPaymentId},provider_capture_id),
      provider_payment_id=${input.providerPaymentId},
      captured_at=COALESCE(captured_at,NOW()),updated_at=NOW()
    WHERE session_id=${input.sessionId}
      AND provider=${input.provider}
  `;

  await neon(db)`
    UPDATE purchase_sessions
    SET
      status='CAPTURED',
      payment_provider=${input.provider},
      provider_order_id=${input.providerOrderId},
      provider_capture_id=${input.providerPaymentId},
      razorpay_payment_link_id=CASE WHEN ${input.provider}='razorpay' THEN ${input.providerOrderId} ELSE razorpay_payment_link_id END,
      razorpay_payment_id=CASE WHEN ${input.provider}='razorpay' THEN ${input.providerPaymentId} ELSE razorpay_payment_id END,
      captured_amount=${input.amount},
      captured_currency=${input.currency},
      captured_at=COALESCE(captured_at,NOW()),updated_at=NOW(),
      completed_at=COALESCE(completed_at,NOW())
    WHERE session_id=${input.sessionId}
  `;
}

export async function markSessionPaymentFailed(db:string,sessionId:string,status:string,preserveCaptured=false){
  await neon(db)`
    UPDATE session_payment_links SET status=${status},updated_at=NOW()
    WHERE session_id=${sessionId}
      AND (NOT ${preserveCaptured} OR status<>'COMPLETED')
  `;
  await neon(db)`
    UPDATE purchase_sessions SET status='FAILED',updated_at=NOW(),completed_at=COALESCE(completed_at,NOW())
    WHERE session_id=${sessionId}
      AND (NOT ${preserveCaptured} OR status<>'CAPTURED')
  `;
}

export async function claimSessionWebhook(db:string,input:{
  payloadHash:string;
  eventType:string;
  provider:PaymentProviderName;
  providerLinkId:string|null;
  providerPaymentId:string|null;
  sessionId:string|null;
  payload:unknown;
}){
  const rows=await neon(db)`
    INSERT INTO session_payment_webhook_events(
      payload_hash,event_type,provider,provider_link_id,provider_payment_id,session_id,payload
    ) VALUES(
      ${input.payloadHash},${input.eventType},${input.provider},${input.providerLinkId},
      ${input.providerPaymentId},${input.sessionId},${JSON.stringify(input.payload)}::jsonb
    )
    ON CONFLICT(payload_hash) DO NOTHING
    RETURNING id::text
  `;
  return rows.length===1;
}

export async function consumeOneTimeAuthorization(db:string,input:{
  authorizationId:string;
  walletId:string;
  sessionId:string;
  quoteHash:string;
  amount:number;
}){
  const rows=await neon(db)`
    SELECT * FROM consume_wallet_one_time_authorization(
      ${input.authorizationId},${input.walletId},${input.sessionId},
      ${input.quoteHash},${input.amount}
    )
  `;
  return rows[0] as {
    consumed:boolean;reason:string;token_hash:string|null;authorization_expires_at:string|null;
  };
}

export async function releaseOneTimeAuthorization(db:string,authorizationId:string,sessionId:string){
  await neon(db)`SELECT release_wallet_one_time_authorization(${authorizationId},${sessionId})`;
}

export async function applyWalletSpendOnce(db:string,input:{
  sessionId:string;
  walletId:string;
  amount:number;
  currency:string;
  provider:PaymentProviderName;
  providerLinkId:string;
  providerPaymentId:string|null;
  verifiedPayPalPayloadHash?:string;
}){
  if(input.provider==='paypal' && !input.verifiedPayPalPayloadHash)
    throw new Error("VERIFIED_PAYPAL_WEBHOOK_REQUIRED");
  const sql=neon(db);
  const rows=input.provider==='paypal'?await sql`
    SELECT * FROM reconcile_paypal_wallet_spend_once_v11_0_3(
      ${input.sessionId},${input.walletId},${input.amount},${input.currency},
      ${input.provider},${input.providerLinkId},${input.providerPaymentId},${input.verifiedPayPalPayloadHash}
    )
  `:await sql`
    SELECT * FROM apply_intent_wallet_spend_once_v11(
      ${input.sessionId},${input.walletId},${input.amount},${input.currency},
      ${input.provider},${input.providerLinkId},${input.providerPaymentId}
    )
  `;
  const r:any=rows[0];
  return {
    applied:Boolean(r.applied),
    ledgerId:String(r.ledger_id),
    spentAmount:Number(r.spent_amount),
    remainingAuthority:Number(r.remaining_authority)
  };
}

export async function getOneTimeAuthorization(db:string,authorizationId:string){
  const rows=await neon(db)`
    SELECT authorization_id,request_id,wallet_id,quote_hash,amount,token_hash,
           expires_at,consumed_at,consumed_by_session_id
    FROM wallet_one_time_authorizations
    WHERE authorization_id=${authorizationId}
    LIMIT 1
  `;
  return rows[0]??null;
}

export async function getWalletLedgerForSession(db:string,sessionId:string){
  const rows=await neon(db)`
    SELECT ledger_id::text,session_id,wallet_id,amount,currency,provider,
           provider_link_id,provider_payment_id,applied_at
    FROM wallet_spend_ledger
    WHERE session_id=${sessionId}
    LIMIT 1
  `;
  return rows[0]??null;
}

export async function persistProofReceipt(db:string,input:{
  receiptId:string;sessionId:string;walletId:string;payload:unknown;
  proofHash:string;proofSignature:string;evidenceAuditHeadHash:string|null;
}){
  const rows=await neon(db)`
    INSERT INTO proof_receipts(
      receipt_id,session_id,wallet_id,payload,proof_hash,proof_signature,evidence_audit_head_hash
    ) VALUES(
      ${input.receiptId},${input.sessionId},${input.walletId},
      ${JSON.stringify(input.payload)}::jsonb,${input.proofHash},
      ${input.proofSignature},${input.evidenceAuditHeadHash}
    )
    ON CONFLICT(session_id)
    -- Concurrent retries must return the first immutable signed receipt.
    DO UPDATE SET session_id=EXCLUDED.session_id
    RETURNING *
  `;
  const r:any=rows[0];
  return {
    receiptId:String(r.receipt_id),sessionId:String(r.session_id),walletId:String(r.wallet_id),
    payload:r.payload as Record<string,unknown>,proofHash:String(r.proof_hash),
    proofSignature:String(r.proof_signature),
    evidenceAuditHeadHash:r.evidence_audit_head_hash?String(r.evidence_audit_head_hash):null,
    createdAt:new Date(String(r.created_at)).toISOString()
  } as ProofReceipt;
}

export async function getProofReceipt(db:string,sessionId:string){
  const rows=await neon(db)`SELECT * FROM proof_receipts WHERE session_id=${sessionId} LIMIT 1`;
  if(!rows.length) return null;
  const r:any=rows[0];
  return {
    receiptId:String(r.receipt_id),sessionId:String(r.session_id),walletId:String(r.wallet_id),
    payload:r.payload as Record<string,unknown>,proofHash:String(r.proof_hash),
    proofSignature:String(r.proof_signature),
    evidenceAuditHeadHash:r.evidence_audit_head_hash?String(r.evidence_audit_head_hash):null,
    createdAt:new Date(String(r.created_at)).toISOString()
  } as ProofReceipt;
}

export async function setSessionProofReceipt(db:string,sessionId:string,receiptId:string){
  await neon(db)`UPDATE purchase_sessions SET proof_receipt_id=${receiptId},updated_at=NOW() WHERE session_id=${sessionId}`;
}

export async function findWhatsappChatForSession(db:string,sessionId:string){
  const rows=await neon(db)`
    SELECT chat_id,waha_session FROM whatsapp_chat_state
    WHERE active_session_id=${sessionId} LIMIT 1
  `;
  if(!rows.length) return null;
  return {chatId:String(rows[0].chat_id),wahaSession:String(rows[0].waha_session??"default")};
}

// Only verified PayPal deliveries are persisted by the webhook ingress.
export async function getVerifiedPayPalWebhook(db:string,payloadHash:string){
  const rows=await neon(db)`
    SELECT session_id,payload FROM session_payment_webhook_events
    WHERE payload_hash=${payloadHash} AND provider='paypal'
      AND event_type='PAYMENT.CAPTURE.COMPLETED'
    LIMIT 1
  `;
  return rows[0]??null;
}
