import { describe, expect, it } from "vitest";
import { evaluatePurchase } from "../policy/engine";
import type { IntentContract, PurchaseProposal } from "../types/contracts";

const intent: IntentContract = {
  id: "intent_test",
  category: "headphones",
  maxAmount: 7000,
  currency: "INR",
  maxQuantity: 1,
  blockedBrands: ["Boat"],
  requiredFeatures: ["wireless", "ANC"],
  preferredFeatures: ["long battery life"],
  requiresApproval: true,
  expiresAt: "2099-01-01T00:00:00.000Z"
};

const proposal: PurchaseProposal = {
  productId: "sony",
  brand: "Sony",
  category: "headphones",
  quantity: 1,
  unitPrice: 5899,
  currency: "INR",
  features: ["Wireless", "ANC", "Bluetooth"],
  inventoryAvailable: true,
  quoteExpiresAt: "2099-01-01T00:00:00.000Z"
};

describe("IntentLock policy engine", () => {
  it("requires explicit approval", () => {
    const result = evaluatePurchase(intent, proposal, false);
    expect(result.code).toBe("REQUIRES_APPROVAL");
    expect(result.allowed).toBe(false);
  });

  it("allows a valid approved transaction", () => {
    const result = evaluatePurchase(intent, proposal, true);
    expect(result.code).toBe("ALLOW");
    expect(result.allowed).toBe(true);
  });

  it("blocks injection-driven quantity and budget escalation", () => {
    const malicious = { ...proposal, quantity: 10 };
    const result = evaluatePurchase(intent, malicious, true);
    expect(result.allowed).toBe(false);
    expect(result.violations).toContain("QUANTITY_EXCEEDED");
    expect(result.violations).toContain("BUDGET_EXCEEDED");
  });

  it("blocks a blocked brand", () => {
    const blocked = { ...proposal, brand: "Boat" };
    const result = evaluatePurchase(intent, blocked, true);
    expect(result.allowed).toBe(false);
    expect(result.violations).toContain("BRAND_BLOCKED");
  });

  it("blocks a product missing a mandatory feature", () => {
    const noAnc = { ...proposal, features: ["wireless"] };
    const result = evaluatePurchase(intent, noAnc, true);
    expect(result.allowed).toBe(false);
    expect(result.violations).toContain("REQUIRED_FEATURE_MISSING");
  });
});
