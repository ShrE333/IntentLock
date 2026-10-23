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
import {buildProofHash,signProofHash,verifyReceiptIntegrity} from "./crypto";
import {appendSessionAuditEvent} from "./audit";
import {getRecipientSettlement,recipientProof} from './recipient-evidence';

export async function createProofReceipt(db:string,signingSecret:string,sessionId:string){
  const existing=await getProofReceipt(db,sessionId);
  if(existing){
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
  const recipientEvidence=payment.provider==='paypal'?await getRecipientSettlement(db,sessionId):null;
  if(payment.provider==='paypal'&&(!payment.expectedRecipient||!recipientEvidence))throw new Error('VERIFIED_PROVIDER_RECIPIENT_REQUIRED');

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
    version:payment.provider==='paypal'?"intentlock-proof-v1.4":"intentlock-proof-v1.3",
    ...(payment.expectedRecipient&&recipientEvidence?{recipientVerification:recipientProof(payment.expectedRecipient,recipientEvidence)}:{}),
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
      features:session.selectedProduct.features,
      source:session.selectedProduct.source??null
    },

    payeeLock:paymentContext?.payeeLock??null,

    paymentContext:{
      buyerCountry:paymentContext?.buyerCountry??wallet.countryCode??"IN",
      merchantCountry:paymentContext?.merchantCountry??session.selectedProduct.merchantCountry??null,
      presentmentAmount:paymentContext?.presentmentAmount??payment.amount,
      presentmentCurrency:paymentContext?.presentmentCurrency??payment.currency,
      walletAmount:paymentContext?.walletAmount??Number(ledger.amount),
      walletCurrency:paymentContext?.walletCurrency??String(ledger.currency),
      fxQuote:paymentContext?.fxQuote??null,
      fxBound:Boolean(paymentContext?.fxQuote),
      payeeFingerprint:paymentContext?.payeeLock?.fingerprint??null
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
    paymentProvider:payment.provider,
    payeeFingerprint:paymentContext?.payeeLock?.fingerprint??null
  });

  return receipt;
}

export async function getVerifiedProofReceipt(db:string,sessionId:string,signingSecret?:string){
  const receipt=await getProofReceipt(db,sessionId);
  if(!receipt) return null;

  const rows=await getAuditEvents(getDb({DATABASE_URL:db}),sessionId);
  const auditVerification=await verifyAuditRows(rows);
  const integrity=await verifyReceiptIntegrity(receipt,signingSecret);
  const evidenceHeadValid=Boolean(receipt.evidenceAuditHeadHash)&&rows.some(row=>row.event_hash===receipt.evidenceAuditHeadHash)&&
    (receipt.payload as any)?.audit?.evidenceHeadHash===receipt.evidenceAuditHeadHash;
  const receiptIdentityValid=(receipt.payload as any)?.session?.sessionId===sessionId&&receipt.sessionId===sessionId&&
    (receipt.payload as any)?.wallet?.walletId===receipt.walletId;
  const payload=receipt.payload as any;
  const paypal=payload?.payment?.provider==='paypal';
  let recipientVerified=false;
  if(paypal&&payload?.recipientVerification){
    try{
      const evidence=await getRecipientSettlement(db,sessionId);
      recipientVerified=Boolean(evidence)&&payload.recipientVerification.status==='VERIFIED'
        &&Boolean(evidence.expected_recipient)&&Object.keys(evidence.expected_recipient).every(k=>payload.recipientVerification.expected?.[k]===evidence.expected_recipient[k])
        &&payload.wallet?.walletId===evidence.wallet_id
        &&payload.payment?.providerOrderId===evidence.order_id&&payload.payment?.providerAuthorizationId===evidence.authorization_id&&payload.payment?.providerCaptureId===evidence.capture_id
        &&payload.recipientVerification.evidenceId===String(evidence.observation_id)
        &&payload.recipientVerification.expected?.fingerprint===evidence.expected_fingerprint
        &&payload.recipientVerification.actualMerchantId===evidence.actual_merchant_id
        &&payload.recipientVerification.expected?.paypalMerchantId===evidence.actual_merchant_id
        &&payload.recipientVerification.environment===evidence.environment;
    }catch{recipientVerified=false;}
  }
  const integrityVerified=integrity.payloadHashValid&&integrity.signatureValid&&auditVerification.valid&&evidenceHeadValid&&receiptIdentityValid;

  return {
    receipt,
    verification:{
      ...integrity,evidenceHeadValid,receiptIdentityValid,
      verified:integrityVerified&&(!paypal||recipientVerified),integrityVerified,recipientVerified,
      recipientStatus:paypal?(recipientVerified?'VERIFIED':'LEGACY_OR_UNVERIFIED'):'NOT_APPLICABLE',
      auditChainValid:auditVerification.valid,
      checkedEvents:auditVerification.checkedEvents,
      currentAuditHeadHash:auditVerification.valid?auditVerification.headHash??null:null,
      evidenceAuditHeadHash:receipt.evidenceAuditHeadHash,
      proofHash:receipt.proofHash,
      signaturePresent:Boolean(receipt.proofSignature)
    }
  };
}
