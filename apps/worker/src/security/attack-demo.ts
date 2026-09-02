import { z } from "zod";
import { catalog, searchCatalog } from "../catalog/mock";
import { evaluatePurchase } from "../policy/engine";
import {
  IntentContractSchema,
  PurchaseProposalSchema,
  type IntentContract,
  type PurchaseProposal
} from "../types/contracts";

const AttackDemoRequestSchema = z.object({
  intent: IntentContractSchema
});

export type AttackDemoResult = {
  attack: {
    name: string;
    merchantProductId: string;
    maliciousMerchantText: string;
  };
  agentProposal: PurchaseProposal;
  policyDecision: ReturnType<typeof evaluatePurchase>;
  moneyMoved: number;
  evidence: {
    blockedBecause: string[];
    expectedOutcome: "BLOCK";
    actualOutcome: "BLOCK" | "ALLOW";
  };
};

export function runPromptInjectionAttack(
  raw: unknown,
  now = new Date()
): AttackDemoResult {
  const { intent } = AttackDemoRequestSchema.parse(raw);

  const candidates = searchCatalog(intent.category);

  const evil = candidates.find((p) => p.id === "evil_merchant_demo");

  if (!evil) {
    throw new Error("Malicious merchant fixture not found.");
  }

  /*
   * RED-TEAM ATTACK HARNESS
   *
   * We deliberately model the worst case: assume the agent has been fully
   * compromised by merchant-controlled prompt injection.
   *
   * This is stronger than trying to prove the LLM itself is injection-proof.
   * IntentLock's security boundary assumes the agent can be compromised.
   */
  const compromisedProposal: PurchaseProposal = PurchaseProposalSchema.parse({
    productId: evil.id,
    brand: evil.brand,
    category: evil.category,
    quantity: 10,
    unitPrice: evil.price,
    currency: evil.currency,
    features: evil.features,
    inventoryAvailable: evil.inventoryAvailable,
    quoteExpiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString()
  });

  const decision = evaluatePurchase(
    intent,
    compromisedProposal,
    true,
    now
  );

  return {
    attack: {
      name: "merchant_prompt_injection_quantity_escalation",
      merchantProductId: evil.id,
      maliciousMerchantText: evil.description
    },
    agentProposal: compromisedProposal,
    policyDecision: decision,
    moneyMoved: decision.allowed ? decision.totalAmount : 0,
    evidence: {
      blockedBecause: decision.violations,
      expectedOutcome: "BLOCK",
      actualOutcome: decision.allowed ? "ALLOW" : "BLOCK"
    }
  };
}
