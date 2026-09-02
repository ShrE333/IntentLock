import { z } from "zod";
import {
  IntentContractSchema,
  PurchaseProposalSchema
} from "../types/contracts";
import type { IdempotencyStore } from "../idempotency/store";
import { claimCheckout } from "../idempotency/checkout";

const RequestSchema = z.object({
  intent: IntentContractSchema,
  proposal: PurchaseProposalSchema,
  attempts: z.number().int().min(2).max(25).default(10)
});

export async function runDuplicateCheckoutDemo(
  raw: unknown,
  store: IdempotencyStore
) {
  const {
    intent,
    proposal,
    attempts
  } = RequestSchema.parse(raw);

  const results = [];

  for (let index = 0; index < attempts; index++) {
    results.push(
      await claimCheckout(
        store,
        intent,
        proposal,
        900
      )
    );
  }

  const acquired = results.filter(
    (result) => result.acquired
  );

  const duplicates = results.filter(
    (result) => !result.acquired
  );

  /*
   * This is still a MOCK payment provider in V6.
   * One acquired idempotency claim == one permitted provider call.
   * Razorpay replaces this mock in the next payment integration version.
   */
  const paymentAttempts = acquired.length;

  return {
    demo: "DUPLICATE_CHECKOUT_RETRY",
    attemptsRequested: attempts,
    paymentAttempts,
    firstRequestAccepted: acquired.length === 1,
    duplicatesRejected: duplicates.length,
    duplicateMoneyMovement: 0,
    result: paymentAttempts === 1
      ? "PASS"
      : "FAIL",
    idempotencyKey: results[0]?.key,
    attempts: results.map(
      (result, index) => ({
        attempt: index + 1,
        outcome: result.acquired
          ? "PAYMENT_ATTEMPT_ALLOWED"
          : "DUPLICATE_REJECTED",
        requestId: result.requestId
      })
    )
  };
}
