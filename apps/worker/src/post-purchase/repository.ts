import {neon} from "@neondatabase/serverless";
import type {RefundReason,RefundRecord} from "./types";

const iso=(v:unknown)=>v?new Date(String(v)).toISOString():null;
const nullable=(v:unknown)=>v==null?null:String(v);

function mapRefund(r:any):RefundRecord{
  return {
    refundId:String(r.refund_id),sessionId:String(r.session_id),walletId:String(r.wallet_id),
    provider:String(r.provider),providerCaptureId:String(r.provider_capture_id),
    providerRefundId:nullable(r.provider_refund_id),idempotencyKey:String(r.idempotency_key),
    reason:String(r.reason) as RefundReason,amount:Number(r.amount),currency:String(r.currency),
    walletCreditAmount:Number(r.wallet_credit_amount),walletCreditCurrency:String(r.wallet_credit_currency),
    status:String(r.status),providerStatus:nullable(r.provider_status),evidenceHash:nullable(r.evidence_hash),
    createdAt:new Date(String(r.created_at)).toISOString(),updatedAt:new Date(String(r.updated_at)).toISOString(),
    completedAt:iso(r.completed_at)
  };
}

export async function listSessionRefunds(db:string,sessionId:string){
  const rows=await neon(db)`
    SELECT * FROM session_refunds WHERE session_id=${sessionId} ORDER BY created_at ASC
  `;
  return rows.map(mapRefund);
}

export async function getRefundById(db:string,refundId:string){
  const rows=await neon(db)`SELECT * FROM session_refunds WHERE refund_id=${refundId} LIMIT 1`;
  return rows.length?mapRefund(rows[0]):null;
}

export async function getRefundByIdempotencyKey(db:string,key:string){
  const rows=await neon(db)`SELECT * FROM session_refunds WHERE idempotency_key=${key} LIMIT 1`;
  return rows.length?mapRefund(rows[0]):null;
}

export async function sumReservedRefundAmount(db:string,sessionId:string){
  const rows=await neon(db)`
    SELECT COALESCE(SUM(amount),0)::text AS total
    FROM session_refunds
    WHERE session_id=${sessionId}
      AND status NOT IN ('FAILED','CANCELLED')
  `;
  return Number(rows[0]?.total??0);
}

export async function reserveRefund(db:string,input:{
  refundId:string;sessionId:string;walletId:string;provider:string;providerCaptureId:string;
  idempotencyKey:string;reason:RefundReason;amount:number;currency:string;
  walletCreditAmount:number;walletCreditCurrency:string;
}){
  const rows=await neon(db)`
    SELECT * FROM reserve_session_refund_v11_4(
      ${input.refundId},${input.sessionId},${input.walletId},${input.provider},${input.providerCaptureId},
      ${input.idempotencyKey},${input.reason},${input.amount},${input.currency},
      ${input.walletCreditAmount},${input.walletCreditCurrency}
    )
  `;
  return mapRefund(rows[0]);
}

export async function markRefundProviderAccepted(db:string,input:{
  refundId:string;providerRefundId:string;providerStatus:string;
}){
  const rows=await neon(db)`
    UPDATE session_refunds SET
      provider_refund_id=${input.providerRefundId},provider_status=${input.providerStatus},
      status='PROVIDER_ACCEPTED',updated_at=NOW()
    WHERE refund_id=${input.refundId}
    RETURNING *
  `;
  return rows.length?mapRefund(rows[0]):null;
}

export async function markRefundFailed(db:string,refundId:string,providerStatus:string){
  const rows=await neon(db)`
    UPDATE session_refunds SET status='FAILED',provider_status=${providerStatus},updated_at=NOW()
    WHERE refund_id=${refundId} RETURNING *
  `;
  return rows.length?mapRefund(rows[0]):null;
}

export async function markRefundCompleted(db:string,input:{refundId:string;providerStatus:string;evidenceHash:string}){
  const rows=await neon(db)`
    UPDATE session_refunds SET
      status='COMPLETED',provider_status=${input.providerStatus},evidence_hash=${input.evidenceHash},
      completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
    WHERE refund_id=${input.refundId}
    RETURNING *
  `;
  return rows.length?mapRefund(rows[0]):null;
}

export async function applyWalletRefundOnce(db:string,input:{
  refundId:string;sessionId:string;walletId:string;amount:number;currency:string;
  provider:string;providerRefundId:string;
}){
  const rows=await neon(db)`
    SELECT * FROM apply_intent_wallet_refund_once_v11_4(
      ${input.refundId},${input.sessionId},${input.walletId},${input.amount},${input.currency},
      ${input.provider},${input.providerRefundId}
    )
  `;
  const r:any=rows[0];
  return {
    applied:Boolean(r.applied),refundLedgerId:String(r.refund_ledger_id),
    spentAmount:Number(r.spent_amount),remainingAuthority:Number(r.remaining_authority)
  };
}
