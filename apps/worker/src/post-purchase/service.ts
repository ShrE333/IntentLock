import {getSession,addEvent} from "../sessions/repository";
import {getSessionPayment,getWalletLedgerForSession} from "../session-payments/repository";
import {appendSessionAuditEvent} from "../session-payments/audit";
import {
  createPayPalRefund,getPayPalRefundDetails,listPayPalDisputes,getPayPalDisputeDetails,
  sendPayPalDisputeMessage,type PayPalEnv
} from "../session-payments/providers/paypal";
import {sha256Hex} from "../wallets/crypto";
import {calculateWalletRefundCredit,evaluateRefundPolicy} from "./policy";
import {
  applyWalletRefundOnce,getRefundById,getRefundByIdempotencyKey,listSessionRefunds,
  markRefundCompleted,markRefundFailed,markRefundProviderAccepted,reserveRefund,sumReservedRefundAmount
} from "./repository";
import type {RefundReason} from "./types";

export type PostPurchaseEnv=PayPalEnv & {
  DATABASE_URL?:string;
  TRUSTOPS_ADMIN_TOKEN?:string;
  REFUND_MAX_AGE_DAYS?:string;
  REFUND_BLOCK_ON_OPEN_DISPUTE?:string;
};

const requireDb=(env:PostPurchaseEnv)=>{
  if(!env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  return env.DATABASE_URL;
};
const maxAge=(env:PostPurchaseEnv)=>{
  const n=Number(env.REFUND_MAX_AGE_DAYS??30);
  return Number.isFinite(n)&&n>0?Math.min(n,365):30;
};
const blockOnDispute=(env:PostPurchaseEnv)=>String(env.REFUND_BLOCK_ON_OPEN_DISPUTE??"true").toLowerCase()!=="false";
const validReason=(v:unknown):RefundReason=>{
  const r=String(v??"CUSTOMER_REQUEST").trim().toUpperCase();
  if(["CUSTOMER_REQUEST","DUPLICATE_CHARGE","ITEM_NOT_RECEIVED","NOT_AS_DESCRIBED","OTHER"].includes(r)) return r as RefundReason;
  throw new Error("INVALID_REFUND_REASON");
};

async function openDisputesForCapture(env:PostPurchaseEnv,captureId:string){
  if(!blockOnDispute(env)) return [];
  const disputes=await listPayPalDisputes(env,captureId);
  return disputes.filter((d:any)=>String(d.status??"").toUpperCase()!=="RESOLVED");
}

export async function evaluateSessionRefund(env:PostPurchaseEnv,sessionId:string,input:{amount:number;currency?:string;reason?:string}){
  const db=requireDb(env);
  const [session,payment,ledger,refunds,reserved]=await Promise.all([
    getSession(db,sessionId),getSessionPayment(db,sessionId),getWalletLedgerForSession(db,sessionId),
    listSessionRefunds(db,sessionId),sumReservedRefundAmount(db,sessionId)
  ]);
  if(!session) throw new Error("SESSION_NOT_FOUND");
  if(!payment) throw new Error("SESSION_PAYMENT_NOT_FOUND");
  if(!ledger) throw new Error("ORIGINAL_WALLET_LEDGER_NOT_FOUND");
  if(!payment.providerCaptureId) throw new Error("PROVIDER_CAPTURE_ID_MISSING");

  const amount=Number(input.amount);
  const currency=String(input.currency??payment.currency).toUpperCase();
  const openDisputes=payment.provider==="paypal"
    ? await openDisputesForCapture(env,payment.providerCaptureId)
    : [];
  const policy=evaluateRefundPolicy({
    sessionStatus:session.status,paymentStatus:payment.status,provider:payment.provider,
    capturedAt:payment.capturedAt,captureAmount:payment.amount,captureCurrency:payment.currency,
    requestedAmount:amount,requestedCurrency:currency,alreadyReservedAmount:reserved,
    maxAgeDays:maxAge(env),openDisputeCount:openDisputes.length,blockOnOpenDispute:blockOnDispute(env)
  });

  const context=session.selectedProduct?.authorizationContext;
  const originalPresentmentAmount=Number(context?.presentmentAmount??payment.amount);
  const originalWalletDebit=Number(context?.walletAmount??(ledger as any).amount);
  let walletCreditAmount=0;
  if(Number.isFinite(amount)&&amount>0&&originalPresentmentAmount>0&&originalWalletDebit>0){
    walletCreditAmount=calculateWalletRefundCredit({
      requestedPresentmentAmount:amount,originalPresentmentAmount,originalWalletDebit
    });
  }
  const reason=validReason(input.reason);
  return {
    sessionId,reason,policy,refunds,
    capture:{amount:payment.amount,currency:payment.currency,provider:payment.provider,captureId:payment.providerCaptureId},
    requested:{amount,currency},
    walletCredit:{amount:walletCreditAmount,currency:String((ledger as any).currency)},
    openDisputes:openDisputes.map((d:any)=>({disputeId:String(d.dispute_id??d.id??""),status:String(d.status??""),reason:String(d.reason??"")}))
  };
}

export async function requestSessionRefund(env:PostPurchaseEnv,sessionId:string,input:{amount:number;currency?:string;reason?:string}){
  const db=requireDb(env);
  const evaluation=await evaluateSessionRefund(env,sessionId,input);
  if(evaluation.policy.decision!=="ALLOW")
    throw new Error(`REFUND_POLICY_BLOCKED:${evaluation.policy.violations.join(",")}`);

  const session=await getSession(db,sessionId);
  if(!session) throw new Error("SESSION_NOT_FOUND");
  const key=await sha256Hex(JSON.stringify({
    version:"intentlock-refund-v11.4",sessionId,captureId:evaluation.capture.captureId,
    amount:evaluation.requested.amount,currency:evaluation.requested.currency,reason:evaluation.reason
  }));
  const existing=await getRefundByIdempotencyKey(db,key);
  if(existing) return {duplicate:true,refund:existing,evaluation};

  const refundId=`rf_${crypto.randomUUID()}`;
  const reserved=await reserveRefund(db,{
    refundId,sessionId,walletId:session.walletId,provider:"paypal",providerCaptureId:evaluation.capture.captureId,
    idempotencyKey:key,reason:evaluation.reason,amount:evaluation.requested.amount,currency:evaluation.requested.currency,
    walletCreditAmount:evaluation.walletCredit.amount,walletCreditCurrency:evaluation.walletCredit.currency
  });

  try{
    const provider=await createPayPalRefund(
      env,evaluation.capture.captureId,evaluation.requested.amount,evaluation.requested.currency,`refund-${key}`
    );
    const saved=await markRefundProviderAccepted(db,{
      refundId,providerRefundId:provider.refundId,providerStatus:provider.status
    });
    await addEvent(db,sessionId,"REFUND_REQUESTED",{
      refundId,provider:"paypal",providerRefundId:provider.refundId,
      amount:evaluation.requested.amount,currency:evaluation.requested.currency,
      walletCreditAmount:evaluation.walletCredit.amount,walletCreditCurrency:evaluation.walletCredit.currency,
      reason:evaluation.reason,idempotencyKey:key
    });
    await appendSessionAuditEvent(db,sessionId,"REFUND_REQUESTED",{
      refundId,providerRefundId:provider.refundId,amount:evaluation.requested.amount,
      currency:evaluation.requested.currency,reason:evaluation.reason,idempotencyKey:key
    });
    return {duplicate:false,refund:saved??reserved,evaluation,provider};
  }catch(error){
    await markRefundFailed(db,refundId,error instanceof Error?error.message:String(error));
    throw error;
  }
}

export async function syncSessionRefund(env:PostPurchaseEnv,refundId:string){
  const db=requireDb(env);
  const refund=await getRefundById(db,refundId);
  if(!refund) throw new Error("REFUND_NOT_FOUND");
  if(refund.status==="COMPLETED") return {duplicate:true,refund};
  if(!refund.providerRefundId) throw new Error("PROVIDER_REFUND_ID_MISSING");

  const provider=await getPayPalRefundDetails(env,refund.providerRefundId);
  if(provider.status==="FAILED"||provider.status==="CANCELLED"){
    const failed=await markRefundFailed(db,refundId,provider.status);
    return {completed:false,refund:failed,provider};
  }
  if(provider.status!=="COMPLETED") return {completed:false,refund,provider};
  if(Math.abs(provider.amount-refund.amount)>0.0001||provider.currency!==refund.currency.toUpperCase())
    throw new Error("REFUND_PROVIDER_AMOUNT_OR_CURRENCY_MISMATCH");

  const credit=await applyWalletRefundOnce(db,{
    refundId:refund.refundId,sessionId:refund.sessionId,walletId:refund.walletId,
    amount:refund.walletCreditAmount,currency:refund.walletCreditCurrency,
    provider:refund.provider,providerRefundId:refund.providerRefundId
  });
  const evidenceHash=await sha256Hex(JSON.stringify({
    version:"intentlock-refund-proof-v1",refundId:refund.refundId,sessionId:refund.sessionId,
    providerRefundId:refund.providerRefundId,providerStatus:provider.status,
    refundAmount:refund.amount,refundCurrency:refund.currency,
    walletCreditAmount:refund.walletCreditAmount,walletCreditCurrency:refund.walletCreditCurrency,
    refundLedgerId:credit.refundLedgerId
  }));
  const completed=await markRefundCompleted(db,{refundId,providerStatus:provider.status,evidenceHash});
  await addEvent(db,refund.sessionId,"REFUND_PROVIDER_CONFIRMED",{
    refundId,providerRefundId:refund.providerRefundId,status:provider.status,
    amount:provider.amount,currency:provider.currency
  });
  await addEvent(db,refund.sessionId,"WALLET_AUTHORITY_RESTORED",{
    refundId,amount:refund.walletCreditAmount,currency:refund.walletCreditCurrency,
    refundLedgerId:credit.refundLedgerId,applied:credit.applied,evidenceHash
  });
  await appendSessionAuditEvent(db,refund.sessionId,"REFUND_PROVIDER_CONFIRMED",{
    refundId,providerRefundId:refund.providerRefundId,status:provider.status,evidenceHash
  });
  await appendSessionAuditEvent(db,refund.sessionId,"WALLET_AUTHORITY_RESTORED",{
    refundId,amount:refund.walletCreditAmount,currency:refund.walletCreditCurrency,
    refundLedgerId:credit.refundLedgerId,applied:credit.applied,evidenceHash
  });
  return {completed:true,refund:completed,provider,walletCredit:credit,evidenceHash};
}

export async function getSessionPostPurchaseState(env:PostPurchaseEnv,sessionId:string){
  const db=requireDb(env);
  const [session,payment,refunds]=await Promise.all([
    getSession(db,sessionId),getSessionPayment(db,sessionId),listSessionRefunds(db,sessionId)
  ]);
  if(!session) throw new Error("SESSION_NOT_FOUND");
  let disputes:any[]=[];
  if(payment?.provider==="paypal"&&payment.providerCaptureId&&env.PAYPAL_CLIENT_ID&&env.PAYPAL_CLIENT_SECRET){
    try{disputes=await listPayPalDisputes(env,payment.providerCaptureId);}catch{}
  }
  return {session,payment,refunds,disputes};
}

export async function getSessionPayPalDisputes(env:PostPurchaseEnv,sessionId:string){
  const db=requireDb(env);
  const payment=await getSessionPayment(db,sessionId);
  if(!payment) throw new Error("SESSION_PAYMENT_NOT_FOUND");
  if(payment.provider!=="paypal"||!payment.providerCaptureId) throw new Error("PAYPAL_CAPTURE_REQUIRED");
  return listPayPalDisputes(env,payment.providerCaptureId);
}

export async function getPayPalDispute(env:PostPurchaseEnv,disputeId:string){
  return getPayPalDisputeDetails(env,disputeId);
}

export async function sendDisputeEvidenceSummary(env:PostPurchaseEnv,disputeId:string,message:string){
  if(!message.trim()) throw new Error("DISPUTE_MESSAGE_REQUIRED");
  const details=await getPayPalDisputeDetails(env,disputeId);
  const links=Array.isArray(details?.links)?details.links:[];
  const canMessage=links.some((x:any)=>{
    const rel=String(x.rel??"").toLowerCase();
    const href=String(x.href??"").toLowerCase();
    return (rel.includes("send")&&rel.includes("message"))||href.includes("/send-message");
  });
  if(!canMessage) throw new Error("PAYPAL_DISPUTE_MESSAGE_NOT_ALLOWED_IN_CURRENT_STATE");
  return sendPayPalDisputeMessage(env,disputeId,message.slice(0,2000));
}
