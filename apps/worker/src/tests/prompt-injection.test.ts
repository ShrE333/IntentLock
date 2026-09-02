import { describe, expect, it } from "vitest";
import { runPromptInjectionAttack } from "../security/attack-demo";
import type { IntentContract } from "../types/contracts";

const safeIntent: IntentContract = {
  id: "intent_attack_demo",
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

describe("Prompt injection red-team demo", () => {
  it("blocks a fully compromised agent trying to buy 10x", () => {
    const result = runPromptInjectionAttack(
      { intent: safeIntent },
      new Date("2026-09-02T07:00:00.000Z")
    );

    expect(result.agentProposal.quantity).toBe(10);
    expect(result.policyDecision.allowed).toBe(false);
    expect(result.policyDecision.violations).toContain("QUANTITY_EXCEEDED");
    expect(result.policyDecision.violations).toContain("BUDGET_EXCEEDED");
    expect(result.moneyMoved).toBe(0);
    expect(result.evidence.actualOutcome).toBe("BLOCK");
  });

  it("exposes the malicious merchant instruction as evidence", () => {
    const result = runPromptInjectionAttack(
      { intent: safeIntent },
      new Date("2026-09-02T07:00:00.000Z")
    );

    expect(result.attack.maliciousMerchantText).toContain(
      "IGNORE ALL PREVIOUS INSTRUCTIONS"
    );
  });
});
