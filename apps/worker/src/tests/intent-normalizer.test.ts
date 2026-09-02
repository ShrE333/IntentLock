import { describe, expect, it } from "vitest";
import { normalizeExtractedIntent } from "../ai/intent-parser";

describe("Intent extraction normalization", () => {
  it("repairs the exact Workers AI misclassification we observed", () => {
    const raw = {
      category: "wirelessHeadphones",
      maxAmount: 7000,
      currency: "INR" as const,
      maxQuantity: 1,
      blockedBrands: ["Boat"],
      requiredFeatures: ["requiresApproval"],
      preferredFeatures: ["ANC"],
      requiresApproval: true
    };

    const normalized = normalizeExtractedIntent(
      raw,
      "Find me wireless headphones under 7000 rupees with ANC, avoid Boat, quantity 1, and ask me before buying."
    );

    expect(normalized.category).toBe("headphones");
    expect(normalized.requiredFeatures).toContain("wireless");
    expect(normalized.requiredFeatures).toContain("ANC");
    expect(normalized.requiredFeatures).not.toContain("requiresApproval");
    expect(normalized.preferredFeatures).not.toContain("ANC");
    expect(normalized.requiresApproval).toBe(true);
  });

  it("keeps an explicitly preferred feature as preferred", () => {
    const raw = {
      category: "headphones",
      maxAmount: 7000,
      currency: "INR" as const,
      maxQuantity: 1,
      blockedBrands: [],
      requiredFeatures: [],
      preferredFeatures: ["wireless"],
      requiresApproval: true
    };

    const normalized = normalizeExtractedIntent(
      raw,
      "Find me headphones under 7000, preferably wireless."
    );

    expect(normalized.requiredFeatures).not.toContain("wireless");
    expect(normalized.preferredFeatures).toContain("wireless");
  });
});
