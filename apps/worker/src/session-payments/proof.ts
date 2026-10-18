import {getAuditEvents,verifyAuditRows} from "../db/audit";
import {getDb} from "../db/client";
import {getWallet} from "../wallets/repository";
import {getSession} from "../sessions/repository";
import {
  getOneTimeAuthorization,
  getProofReceipt,
  getSessionPayment,
  getWalletLedgerForSession,
  persistProofReceipt,
  setSessionProofReceipt
} from "./repository";
import {buildProofHash,signProofHash} from "./crypto";
import {appendSessionAuditEvent} from "./audit";

export async function createProofReceipt(db:string,signingSecret:string,sessionId:string){
  const existing=await getProofReceipt(db,sessionId);
  if(existing){
    // Recover a crash after receipt insertion but before session attachment.
    await setSessionProofReceipt(db,sessionId,existing.receiptId);
    return existing;
  }

  const session=await getSession(db,sessionId);
  if(!session) throw new Error("SESSION_NOT_FOUND");
  if(session.status!=="CAPTURED") throw new Error("SESSION_NOT_CAPTURED");
  if(!session.selectedProduct) throw new Error("SESSION_PRODUCT_NOT_FOUND");

  const wallet=await getWallet(db,session.walletId);
  if(!wallet) throw new Error("WALLET_NOT_FOUND");

  const payment=await getSessionPayment(db,sessionId);
  if(!payment||payment.status!=="COMPLETED")
    throw new Error("CAPTURED_PAYMENT_RECORD_NOT_FOUND");

  const ledger:any=await getWalletLedgerForSession(db,sessionId);
  if(!ledger) throw new Error("WALLET_SPEND_LEDGER_NOT_FOUND");

  const authorization=session.authorizationId
    ? await getOneTimeAuthorization(db,session.authorizationId)
    : null;

  const auditRows=await getAuditEvents(getDb({DATABASE_URL:db}),sessionId);
  const auditVerification=await verifyAuditRows(auditRows);
  if(!auditVerification.valid)
    throw new Error(`AUDIT_CHAIN_INVALID:${auditVerification.reason}`);

  const evidenceAuditHeadHash=auditVerification.headHash??null;
  const walletSpent=Number(wallet.spentAmount);
  const paymentContext=session.selectedProduct.authorizationContext??null;

  const payload={
    version:"intentlock-proof-v1.2",
    generatedAt:new Date().toISOString(),

    session:{
      sessionId:session.sessionId,
      channel:session.channel,
      userPrompt:session.userPrompt,
      status:session.status
    },

    wallet:{
      walletId:wallet.walletId,
      name:wallet.name,
      countryCode:wallet.countryCode??"IN",
      currency:wallet.currency,
      totalAuthority:wallet.totalAuthority,
      spentAmountAfter:walletSpent,
      remainingAuthority:wallet.totalAuthority-walletSpent
    },

    product:{
      id:session.selectedProduct.id,
      title:session.selectedProduct.title,
      brand:session.selectedProduct.brand,
      merchant:session.selectedProduct.merchant,
      merchantCountry:session.selectedProduct.merchantCountry??paymentContext?.merchantCountry??null,
      amount:session.selectedProduct.price,
      currency:session.selectedProduct.currency,
      features:session.selectedProduct.features
    },

    paymentContext:{
      buyerCountry:paymentContext?.buyerCountry??wallet.countryCode??"IN",
      merchantCountry:paymentContext?.merchantCountry??session.selectedProduct.merchantCountry??null,
      presentmentAmount:paymentContext?.presentmentAmount??payment.amount,
      presentmentCurrency:paymentContext?.presentmentCurrency??payment.currency,
      walletAmount:paymentContext?.walletAmount??Number(ledger.amount),
      walletCurrency:paymentContext?.walletCurrency??String(ledger.currency),
      fxQuote:paymentContext?.fxQuote??null,
      fxBound:Boolean(paymentContext?.fxQuote)
    },

    authorization:{
      policyDecision:session.selectedDecision,
      mode:authorization?"SIGNED_ONE_TIME_AUTHORIZATION":"INTENT_WALLET_POLICY_AT_EXECUTION",
      stepUpRequestId:session.stepUpRequestId,
      authorizationId:session.authorizationId,
      quoteHash:session.quoteHash,
      oneTimeTokenHash:authorization?String(authorization.token_hash):null,
      oneTimeConsumedAt:authorization?.consumed_at
        ? new Date(String(authorization.consumed_at)).toISOString()
        : null,
      exactQuoteBound:Boolean(session.quoteHash)
    },

    payment:{
      provider:payment.provider,
      providerOrderId:payment.providerOrderId,
      providerAuthorizationId:payment.providerAuthorizationId,
      providerCaptureId:payment.providerCaptureId,
      amount:payment.amount,
      currency:payment.currency,
      status:payment.status,
      capturedAt:payment.capturedAt,
      webhookSignatureVerified:true,
      idempotencyKey:payment.idempotencyKey,
      capturedStateSource:"VERIFIED_PROVIDER_WEBHOOK"
    },

    walletSpend:{
      ledgerId:String(ledger.ledger_id),
      provider:String(ledger.provider),
      amount:Number(ledger.amount),
      currency:String(ledger.currency),
      appliedAt:new Date(String(ledger.applied_at)).toISOString(),
      replaySafe:true
    },

    audit:{
      valid:true,
      checkedEvents:auditVerification.checkedEvents,
      evidenceHeadHash:evidenceAuditHeadHash
    }
  };

  const proofHash=await buildProofHash(payload);
  const proofSignature=await signProofHash(signingSecret,proofHash);
  const receiptId=`pr_${crypto.randomUUID()}`;

  const receipt=await persistProofReceipt(db,{
    receiptId,sessionId,walletId:wallet.walletId,payload,proofHash,
    proofSignature,evidenceAuditHeadHash
  });

  await setSessionProofReceipt(db,sessionId,receipt.receiptId);
  await appendSessionAuditEvent(db,sessionId,"PROOF_RECEIPT_CREATED",{
    receiptId:receipt.receiptId,proofHash:receipt.proofHash,proofSignature:receipt.proofSignature,
    evidenceAuditHeadHash:receipt.evidenceAuditHeadHash,
    paymentProvider:payment.provider
  });

  return receipt;
}

export async function getVerifiedProofReceipt(db:string,sessionId:string){
  const receipt=await getProofReceipt(db,sessionId);
  if(!receipt) return null;

  const rows=await getAuditEvents(getDb({DATABASE_URL:db}),sessionId);
  const auditVerification=await verifyAuditRows(rows);

  return {
    receipt,
    verification:{
      auditChainValid:auditVerification.valid,
      checkedEvents:auditVerification.checkedEvents,
      currentAuditHeadHash:auditVerification.valid?auditVerification.headHash??null:null,
      evidenceAuditHeadHash:receipt.evidenceAuditHeadHash,
      proofHash:receipt.proofHash,
      signaturePresent:Boolean(receipt.proofSignature)
    }
  };
}
