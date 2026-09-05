import {neon} from "@neondatabase/serverless";
import type {SessionPaymentLink,ProofReceipt} from "./types";

function iso(v:unknown){ return v ? new Date(String(v)).toISOString() : null; }

function mapLink(r:any):SessionPaymentLink{
  return {
    sessionId:String(r.session_id),
    provider:"razorpay",
    providerLinkId:String(r.provider_link_id),
    referenceId:String(r.reference_id),
    shortUrl:String(r.short_url),
    amount:Number(r.amount),
    currency:"INR",
    status:String(r.status),
    expiresAt:iso(r.expires_at),
    providerPaymentId:r.provider_payment_id?String(r.provider_payment_id):null,
    capturedAt:iso(r.captured_at)
  };
}

export async function getSessionPaymentLink(db:string,sessionId:string){
  const rows=await neon(db)`
    SELECT *
    FROM session_payment_links
    WHERE session_id=${sessionId}
      AND provider_link_id IS NOT NULL
    LIMIT 1
  `;
  return rows.length?mapLink(rows[0]):null;
}

export async function getSessionPaymentLinkByProviderId(
  db:string,
  providerLinkId:string
){
  const rows=await neon(db)`
    SELECT *
    FROM session_payment_links
    WHERE provider_link_id=${providerLinkId}
    LIMIT 1
  `;
  return rows.length?mapLink(rows[0]):null;
}


export async function reserveSessionPayment(
  db:string,
  input:{
    sessionId:string;
    walletId:string;
    authorizationId:string|null;
    quoteHash:string;
    idempotencyKey:string;
    amount:number;
    currency:"INR";
  }
){
  const rows=await neon(db)`
    INSERT INTO session_payment_links(
      session_id,wallet_id,authorization_id,quote_hash,
      idempotency_key,amount,currency,status
    )
    VALUES(
      ${input.sessionId},${input.walletId},${input.authorizationId},
      ${input.quoteHash},${input.idempotencyKey},
      ${input.amount},${input.currency},'CREATING'
    )
    ON CONFLICT(session_id)
    DO UPDATE SET
      authorization_id=EXCLUDED.authorization_id,
      quote_hash=EXCLUDED.quote_hash,
      idempotency_key=EXCLUDED.idempotency_key,
      amount=EXCLUDED.amount,
      currency=EXCLUDED.currency,
      status=CASE
        WHEN session_payment_links.provider_link_id IS NULL
          THEN 'CREATING'
        ELSE session_payment_links.status
      END,
      updated_at=NOW()
    RETURNING
      session_id,
      provider_link_id,
      status
  `;

  return rows[0] as {
    session_id:string;
    provider_link_id:string|null;
    status:string;
  };
}

export async function markSessionPaymentCreationFailed(
  db:string,
  sessionId:string,
  message:string
){
  await neon(db)`
    UPDATE session_payment_links
    SET
      status='FAILED',
      updated_at=NOW()
    WHERE session_id=${sessionId}
      AND provider_link_id IS NULL
  `;

  await neon(db)`
    UPDATE purchase_sessions
    SET updated_at=NOW()
    WHERE session_id=${sessionId}
  `;
}

export async function persistSessionPaymentLink(
  db:string,
  input:{
    sessionId:string;
    walletId:string;
    authorizationId:string|null;
    quoteHash:string;
    idempotencyKey:string;
    providerLinkId:string;
    referenceId:string;
    shortUrl:string;
    amount:number;
    currency:"INR";
    status:string;
    expiresAt:string|null;
  }
){
  const rows=await neon(db)`
    INSERT INTO session_payment_links(
      session_id,wallet_id,authorization_id,quote_hash,idempotency_key,
      provider_link_id,reference_id,short_url,amount,currency,status,expires_at
    )
    VALUES(
      ${input.sessionId},${input.walletId},${input.authorizationId},
      ${input.quoteHash},${input.idempotencyKey},
      ${input.providerLinkId},${input.referenceId},${input.shortUrl},
      ${input.amount},${input.currency},${input.status},
      ${input.expiresAt}::timestamptz
    )
    ON CONFLICT(session_id)
    DO UPDATE SET
      provider_link_id=EXCLUDED.provider_link_id,
      reference_id=EXCLUDED.reference_id,
      short_url=EXCLUDED.short_url,
      status=EXCLUDED.status,
      expires_at=EXCLUDED.expires_at,
      updated_at=NOW()
    RETURNING *
  `;
  return mapLink(rows[0]);
}

export async function markSessionPaymentCaptured(
  db:string,
  input:{
    sessionId:string;
    providerLinkId:string;
    providerPaymentId:string|null;
    amount:number;
    currency:"INR";
  }
){
  await neon(db)`
    UPDATE session_payment_links
    SET
      status='paid',
      provider_payment_id=${input.providerPaymentId},
      captured_at=NOW(),
      updated_at=NOW()
    WHERE session_id=${input.sessionId}
      AND provider_link_id=${input.providerLinkId}
  `;

  await neon(db)`
    UPDATE purchase_sessions
    SET
      status='CAPTURED',
      razorpay_payment_link_id=${input.providerLinkId},
      razorpay_payment_id=${input.providerPaymentId},
      captured_amount=${input.amount},
      captured_currency=${input.currency},
      captured_at=NOW(),
      updated_at=NOW(),
      completed_at=COALESCE(completed_at,NOW())
    WHERE session_id=${input.sessionId}
  `;
}

export async function updateSessionPaymentPending(
  db:string,
  input:{
    sessionId:string;
    quoteHash:string;
    idempotencyKey:string;
    providerLinkId:string;
    shortUrl:string;
  }
){
  await neon(db)`
    UPDATE purchase_sessions
    SET
      status='PAYMENT_PENDING',
      quote_hash=${input.quoteHash},
      payment_idempotency_key=${input.idempotencyKey},
      razorpay_payment_link_id=${input.providerLinkId},
      payment_link_url=${input.shortUrl},
      updated_at=NOW()
    WHERE session_id=${input.sessionId}
  `;
}

export async function claimSessionWebhook(
  db:string,
  input:{
    payloadHash:string;
    eventType:string;
    providerLinkId:string|null;
    providerPaymentId:string|null;
    sessionId:string|null;
    payload:unknown;
  }
){
  const rows=await neon(db)`
    INSERT INTO session_payment_webhook_events(
      payload_hash,event_type,provider_link_id,provider_payment_id,session_id,payload
    )
    VALUES(
      ${input.payloadHash},${input.eventType},${input.providerLinkId},
      ${input.providerPaymentId},${input.sessionId},
      ${JSON.stringify(input.payload)}::jsonb
    )
    ON CONFLICT(payload_hash) DO NOTHING
    RETURNING id::text
  `;
  return rows.length===1;
}

export async function consumeOneTimeAuthorization(
  db:string,
  input:{
    authorizationId:string;
    walletId:string;
    sessionId:string;
    quoteHash:string;
    amount:number;
  }
){
  const rows=await neon(db)`
    SELECT *
    FROM consume_wallet_one_time_authorization(
      ${input.authorizationId},
      ${input.walletId},
      ${input.sessionId},
      ${input.quoteHash},
      ${input.amount}
    )
  `;
  return rows[0] as {
    consumed:boolean;
    reason:string;
    token_hash:string|null;
    authorization_expires_at:string|null;
  };
}

export async function releaseOneTimeAuthorization(
  db:string,
  authorizationId:string,
  sessionId:string
){
  await neon(db)`
    SELECT release_wallet_one_time_authorization(
      ${authorizationId},
      ${sessionId}
    )
  `;
}

export async function applyWalletSpendOnce(
  db:string,
  input:{
    sessionId:string;
    walletId:string;
    amount:number;
    currency:"INR";
    providerLinkId:string;
    providerPaymentId:string|null;
  }
){
  const rows=await neon(db)`
    SELECT *
    FROM apply_intent_wallet_spend_once(
      ${input.sessionId},
      ${input.walletId},
      ${input.amount},
      ${input.currency},
      ${input.providerLinkId},
      ${input.providerPaymentId}
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
    SELECT
      authorization_id,
      request_id,
      wallet_id,
      quote_hash,
      amount,
      token_hash,
      expires_at,
      consumed_at,
      consumed_by_session_id
    FROM wallet_one_time_authorizations
    WHERE authorization_id=${authorizationId}
    LIMIT 1
  `;
  return rows[0]??null;
}

export async function getWalletLedgerForSession(db:string,sessionId:string){
  const rows=await neon(db)`
    SELECT
      ledger_id::text,
      session_id,
      wallet_id,
      amount,
      currency,
      provider,
      provider_link_id,
      provider_payment_id,
      applied_at
    FROM wallet_spend_ledger
    WHERE session_id=${sessionId}
    LIMIT 1
  `;
  return rows[0]??null;
}

export async function persistProofReceipt(
  db:string,
  input:{
    receiptId:string;
    sessionId:string;
    walletId:string;
    payload:unknown;
    proofHash:string;
    proofSignature:string;
    evidenceAuditHeadHash:string|null;
  }
){
  const rows=await neon(db)`
    INSERT INTO proof_receipts(
      receipt_id,session_id,wallet_id,payload,proof_hash,proof_signature,
      evidence_audit_head_hash
    )
    VALUES(
      ${input.receiptId},${input.sessionId},${input.walletId},
      ${JSON.stringify(input.payload)}::jsonb,
      ${input.proofHash},${input.proofSignature},${input.evidenceAuditHeadHash}
    )
    ON CONFLICT(session_id)
    DO UPDATE SET
      payload=EXCLUDED.payload,
      proof_hash=EXCLUDED.proof_hash,
      proof_signature=EXCLUDED.proof_signature,
      evidence_audit_head_hash=EXCLUDED.evidence_audit_head_hash
    RETURNING *
  `;

  const r:any=rows[0];
  return {
    receiptId:String(r.receipt_id),
    sessionId:String(r.session_id),
    walletId:String(r.wallet_id),
    payload:r.payload as Record<string,unknown>,
    proofHash:String(r.proof_hash),
    proofSignature:String(r.proof_signature),
    evidenceAuditHeadHash:r.evidence_audit_head_hash?String(r.evidence_audit_head_hash):null,
    createdAt:new Date(String(r.created_at)).toISOString()
  } as ProofReceipt;
}

export async function getProofReceipt(db:string,sessionId:string){
  const rows=await neon(db)`
    SELECT *
    FROM proof_receipts
    WHERE session_id=${sessionId}
    LIMIT 1
  `;

  if(!rows.length) return null;
  const r:any=rows[0];

  return {
    receiptId:String(r.receipt_id),
    sessionId:String(r.session_id),
    walletId:String(r.wallet_id),
    payload:r.payload as Record<string,unknown>,
    proofHash:String(r.proof_hash),
    proofSignature:String(r.proof_signature),
    evidenceAuditHeadHash:r.evidence_audit_head_hash?String(r.evidence_audit_head_hash):null,
    createdAt:new Date(String(r.created_at)).toISOString()
  } as ProofReceipt;
}

export async function setSessionProofReceipt(
  db:string,
  sessionId:string,
  receiptId:string
){
  await neon(db)`
    UPDATE purchase_sessions
    SET proof_receipt_id=${receiptId},updated_at=NOW()
    WHERE session_id=${sessionId}
  `;
}

export async function findWhatsappChatForSession(db:string,sessionId:string){
  const rows=await neon(db)`
    SELECT chat_id,waha_session
    FROM whatsapp_chat_state
    WHERE active_session_id=${sessionId}
    LIMIT 1
  `;
  if(!rows.length) return null;
  return {
    chatId:String(rows[0].chat_id),
    wahaSession:String(rows[0].waha_session??"default")
  };
}
