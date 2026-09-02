import type {
  IntentContract,
  PurchaseProposal,
  PolicyResult
} from "../types/contracts";

const normalize = (value: string) => value.trim().toLowerCase();

export function evaluatePurchase(
  intent: IntentContract,
  proposal: PurchaseProposal,
  approved: boolean,
  now = new Date()
): PolicyResult {
  const violations: string[] = [];
  const totalAmount = proposal.quantity * proposal.unitPrice;

  if (new Date(intent.expiresAt) <= now) violations.push("INTENT_EXPIRED");
  if (new Date(proposal.quoteExpiresAt) <= now) violations.push("QUOTE_EXPIRED");

  if (proposal.currency !== intent.currency) {
    violations.push("CURRENCY_MISMATCH");
  }

  if (normalize(proposal.category) !== normalize(intent.category)) {
    violations.push("CATEGORY_MISMATCH");
  }

  if (proposal.quantity > intent.maxQuantity) {
    violations.push("QUANTITY_EXCEEDED");
  }

  if (totalAmount > intent.maxAmount) {
    violations.push("BUDGET_EXCEEDED");
  }

  const blockedBrands = new Set(intent.blockedBrands.map(normalize));
  if (blockedBrands.has(normalize(proposal.brand))) {
    violations.push("BRAND_BLOCKED");
  }

  const productFeatures = new Set(proposal.features.map(normalize));
  const missingFeatures = intent.requiredFeatures.filter(
    (feature) => !productFeatures.has(normalize(feature))
  );

  if (missingFeatures.length > 0) {
    violations.push("REQUIRED_FEATURE_MISSING");
  }

  if (!proposal.inventoryAvailable) {
    violations.push("OUT_OF_STOCK");
  }

  if (violations.length > 0) {
    return {
      allowed: false,
      code: violations[0] as PolicyResult["code"],
      violations,
      totalAmount
    };
  }

  if (intent.requiresApproval && !approved) {
    return {
      allowed: false,
      code: "REQUIRES_APPROVAL",
      violations: [],
      totalAmount
    };
  }

  return {
    allowed: true,
    code: "ALLOW",
    violations: [],
    totalAmount
  };
}
