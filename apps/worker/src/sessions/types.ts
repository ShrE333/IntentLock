import type {CommerceProduct} from "../commerce/types";

export type SessionStatus =
  | "CREATED" | "SEARCHING" | "READY_TO_PAY" | "AWAITING_STEP_UP"
  | "BLOCKED" | "REJECTED" | "PAYMENT_PENDING" | "CAPTURED"
  | "FAILED" | "CANCELLED";

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

  razorpayPaymentLinkId:string|null;
  razorpayPaymentId:string|null;
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
