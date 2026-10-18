import type {CommerceProduct} from "../commerce/types";
import type {PaymentProviderName} from "../session-payments/providers/types";

export type SessionStatus =
  | "CREATED" | "SEARCHING" | "READY_TO_PAY" | "AWAITING_STEP_UP"
  | "BLOCKED" | "REJECTED" | "PAYMENT_PENDING" | "PAYPAL_APPROVAL_PENDING"
  | "AUTHORIZED" | "CAPTURE_PENDING" | "CAPTURED" | "FAILED" | "CANCELLED";

export type PurchaseSession = {
  sessionId:string;
  walletId:string;
  channel:"WEB"|"WHATSAPP"|"API";
  connectorId:string;
  userPrompt:string;
  status:SessionStatus;

  selectedProduct:CommerceProduct|null;
  selectedDecision:"ALLOW"|"STEP_UP"|"BLOCK"|null;

  stepUpRequestId:string|null;
  authorizationId:string|null;

  quoteHash:string|null;
  paymentLinkUrl:string|null;
  paymentIdempotencyKey:string|null;
  paymentProvider:PaymentProviderName|null;
  providerOrderId:string|null;
  providerAuthorizationId:string|null;
  providerCaptureId:string|null;

  // Kept for backwards compatibility with existing Razorpay sessions.
  razorpayPaymentLinkId:string|null;
  razorpayPaymentId:string|null;

  capturedAmount:number|null;
  capturedCurrency:string|null;
  capturedAt:string|null;
  proofReceiptId:string|null;

  createdAt:string;
  updatedAt:string;
  completedAt:string|null;
};

export type SessionEvent = {
  eventSeq:number;
  eventId:string;
  sessionId:string;
  eventType:string;
  payload:Record<string,unknown>;
  occurredAt:string;
};
