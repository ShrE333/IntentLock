import { z } from "zod";
import {
  IntentContractSchema,
  PurchaseProposalSchema
} from "../types/contracts";
import {
  createApprovalToken,
  verifyApprovalToken
} from "./approval";

const StalePriceRequestSchema = z.object({
  intent: IntentContractSchema,
  proposal: PurchaseProposalSchema,
  newUnitPrice: z.number().positive().optional()
});

export async function runStalePriceDemo(
  raw: unknown,
  secret: string,
  now = new Date()
) {
  const { intent, proposal, newUnitPrice } =
    StalePriceRequestSchema.parse(raw);

  const approved = await createApprovalToken(
    intent,
    proposal,
    secret,
    300,
    now
  );

  const changedProposal = {
    ...proposal,
    unitPrice: newUnitPrice ?? proposal.unitPrice + 500
  };

  const verification = await verifyApprovalToken(
    approved.token,
    intent,
    changedProposal,
    secret,
    new Date(now.getTime() + 1000)
  );

  return {
    demo: "STALE_PRICE_AFTER_APPROVAL",
    approval: {
      approvalId: approved.payload.approvalId,
      approvedAmount: approved.payload.amount,
      approvedQuoteHash: approved.payload.quoteHash,
      expiresAt: approved.payload.expiresAt
    },
    merchantChange: {
      originalUnitPrice: proposal.unitPrice,
      currentUnitPrice: changedProposal.unitPrice,
      delta: changedProposal.unitPrice - proposal.unitPrice
    },
    checkoutVerification: verification,
    moneyMoved: verification.allowed
      ? changedProposal.quantity * changedProposal.unitPrice
      : 0,
    trace: [
      {
        step: 1,
        event: "QUOTE_CREATED",
        amount: proposal.quantity * proposal.unitPrice
      },
      {
        step: 2,
        event: "USER_APPROVED_EXACT_QUOTE",
        quoteHash: approved.payload.quoteHash
      },
      {
        step: 3,
        event: "MERCHANT_PRICE_CHANGED",
        oldPrice: proposal.unitPrice,
        newPrice: changedProposal.unitPrice
      },
      {
        step: 4,
        event: verification.allowed
          ? "CHECKOUT_ALLOWED"
          : "CHECKOUT_BLOCKED",
        reason: verification.code
      }
    ]
  };
}
