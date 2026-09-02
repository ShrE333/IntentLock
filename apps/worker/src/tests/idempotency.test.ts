import { describe, expect, it } from "vitest";
import { MemoryIdempotencyStore } from "../idempotency/store";
import { runDuplicateCheckoutDemo } from "../security/duplicate-checkout-demo";
import type {
  IntentContract,
  PurchaseProposal
} from "../types/contracts";

const intent: IntentContract = {
  id: "intent_duplicate_test",
  category: "headphones",
  maxAmount: 7000,
  currency: "INR",
  maxQuantity: 1,
  blockedBrands: ["Boat"],
  requiredFeatures: ["wireless", "ANC"],
  preferredFeatures: [],
  requiresApproval: true,
  expiresAt: "2099-01-01T00:00:00.000Z"
};

const proposal: PurchaseProposal = {
  productId: "sony_wh_demo",
  brand: "Sony",
  category: "headphones",
  quantity: 1,
  unitPrice: 5899,
  currency: "INR",
  features: ["wireless", "ANC"],
  inventoryAvailable: true,
  quoteExpiresAt: "2099-01-01T00:00:00.000Z"
};

describe("Checkout idempotency", () => {
  it("allows only one payment attempt across 10 retries", async () => {
    const store = new MemoryIdempotencyStore();

    const result = await runDuplicateCheckoutDemo(
      {
        intent,
        proposal,
        attempts: 10
      },
      store
    );

    expect(result.result).toBe("PASS");
    expect(result.paymentAttempts).toBe(1);
    expect(result.duplicatesRejected).toBe(9);
    expect(result.duplicateMoneyMovement).toBe(0);
  });

  it("generates the same key for the same checkout", async () => {
    const store = new MemoryIdempotencyStore();

    const first = await runDuplicateCheckoutDemo(
      {
        intent,
        proposal,
        attempts: 2
      },
      store
    );

    expect(first.attempts[0].outcome).toBe(
      "PAYMENT_ATTEMPT_ALLOWED"
    );
    expect(first.attempts[1].outcome).toBe(
      "DUPLICATE_REJECTED"
    );
  });
});
