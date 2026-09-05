export type SessionPaymentLink = {
  sessionId:string;
  provider:"razorpay";
  providerLinkId:string;
  referenceId:string;
  shortUrl:string;
  amount:number;
  currency:"INR";
  status:string;
  expiresAt:string|null;
  providerPaymentId:string|null;
  capturedAt:string|null;
};

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
