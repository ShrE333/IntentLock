import { describe, expect, it } from "vitest";
import {
  createApprovalToken,
  verifyApprovalToken
} from "../security/approval";
import type {
  IntentContract,
  PurchaseProposal
} from "../types/contracts";

const secret =
  "intentlock-test-secret-that-is-long-enough-for-hmac";

const intent: IntentContract = {
  id: "intent_approval_test",
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

const now = new Date("2026-09-02T07:00:00.000Z");

describe("Cryptographic approval tokens", () => {
  it("verifies the exact cart the user approved", async () => {
    const approval = await createApprovalToken(
      intent,
      proposal,
      secret,
      300,
      now
    );

    const result = await verifyApprovalToken(
      approval.token,
      intent,
      proposal,
      secret,
      new Date(now.getTime() + 1000)
    );

    expect(result.allowed).toBe(true);
    expect(result.code).toBe("APPROVAL_VALID");
  });

  it("blocks a stale price even when the new price is still under budget", async () => {
    const approval = await createApprovalToken(
      intent,
      proposal,
      secret,
      300,
      now
    );

    const changed = {
      ...proposal,
      unitPrice: 6399
    };

    const result = await verifyApprovalToken(
      approval.token,
      intent,
      changed,
      secret,
      new Date(now.getTime() + 1000)
    );

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("QUOTE_CHANGED");
  });

  it("blocks quantity changes after approval", async () => {
    const approval = await createApprovalToken(
      intent,
      proposal,
      secret,
      300,
      now
    );

    const changed = {
      ...proposal,
      quantity: 2
    };

    const result = await verifyApprovalToken(
      approval.token,
      intent,
      changed,
      secret,
      new Date(now.getTime() + 1000)
    );

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("QUOTE_CHANGED");
  });

  it("rejects an expired approval token", async () => {
    const approval = await createApprovalToken(
      intent,
      proposal,
      secret,
      1,
      now
    );

    const result = await verifyApprovalToken(
      approval.token,
      intent,
      proposal,
      secret,
      new Date(now.getTime() + 2000)
    );

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("APPROVAL_EXPIRED");
  });

  it("rejects a tampered token", async () => {
    const approval = await createApprovalToken(
      intent,
      proposal,
      secret,
      300,
      now
    );

    const [payload, signature] = approval.token.split(".");
    const tampered = `${payload.slice(0, -1)}A.${signature}`;

    const result = await verifyApprovalToken(
      tampered,
      intent,
      proposal,
      secret,
      new Date(now.getTime() + 1000)
    );

    expect(result.allowed).toBe(false);
    expect(["INVALID_SIGNATURE", "INVALID_TOKEN"]).toContain(result.code);
  });
});
