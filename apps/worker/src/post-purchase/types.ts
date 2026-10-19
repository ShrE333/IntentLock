export type RefundReason =
  | "CUSTOMER_REQUEST"
  | "DUPLICATE_CHARGE"
  | "ITEM_NOT_RECEIVED"
  | "NOT_AS_DESCRIBED"
  | "OTHER";

export type RefundDecision = "ALLOW" | "BLOCK";

export type RefundPolicyInput = {
  sessionStatus:string;
  paymentStatus:string|null;
  provider:string|null;
  capturedAt:string|null;
  captureAmount:number;
  captureCurrency:string;
  requestedAmount:number;
  requestedCurrency:string;
  alreadyReservedAmount:number;
  now?:Date;
  maxAgeDays:number;
  openDisputeCount:number;
  blockOnOpenDispute:boolean;
};

export type RefundPolicyResult = {
  decision:RefundDecision;
  violations:string[];
  reasons:string[];
  refundableRemaining:number;
};

export type RefundRecord = {
  refundId:string;
  sessionId:string;
  walletId:string;
  provider:string;
  providerCaptureId:string;
  providerRefundId:string|null;
  idempotencyKey:string;
  reason:RefundReason;
  amount:number;
  currency:string;
  walletCreditAmount:number;
  walletCreditCurrency:string;
  status:string;
  providerStatus:string|null;
  evidenceHash:string|null;
  createdAt:string;
  updatedAt:string;
  completedAt:string|null;
};
