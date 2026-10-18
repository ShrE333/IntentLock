import type {PaymentProviderName} from "./providers/types";

export type SessionPaymentRecord = {
  sessionId:string;
  walletId:string;
  quoteHash:string;
  idempotencyKey:string;
  provider:PaymentProviderName;
  providerOrderId:string|null;
  providerAuthorizationId:string|null;
  providerCaptureId:string|null;
  referenceId:string|null;
  checkoutUrl:string|null;
  amount:number;
  currency:string;
  status:string;
  expiresAt:string|null;
  capturedAt:string|null;
};

// Backwards-compatible alias used by existing imports.
export type SessionPaymentLink = SessionPaymentRecord;

export type ProofReceipt = {
  receiptId:string;
  sessionId:string;
  walletId:string;
  proofHash:string;
  proofSignature:string;
  evidenceAuditHeadHash:string|null;
  payload:Record<string,unknown>;
  createdAt:string;
};
