import { z } from "zod";

export const IntentContractSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  maxAmount: z.number().positive(),
  currency: z.literal("INR"),
  maxQuantity: z.number().int().positive().default(1),
  blockedBrands: z.array(z.string()).default([]),
  requiredFeatures: z.array(z.string()).default([]),
  preferredFeatures: z.array(z.string()).default([]),
  requiresApproval: z.boolean().default(true),
  expiresAt: z.string().datetime()
});

export const PurchaseProposalSchema = z.object({
  productId: z.string().min(1),
  brand: z.string().min(1),
  category: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  currency: z.literal("INR"),
  features: z.array(z.string()).default([]),
  inventoryAvailable: z.boolean(),
  quoteExpiresAt: z.string().datetime()
});

export type IntentContract = z.infer<typeof IntentContractSchema>;
export type PurchaseProposal = z.infer<typeof PurchaseProposalSchema>;

export type PolicyCode =
  | "ALLOW"
  | "REQUIRES_APPROVAL"
  | "INTENT_EXPIRED"
  | "QUOTE_EXPIRED"
  | "BUDGET_EXCEEDED"
  | "QUANTITY_EXCEEDED"
  | "BRAND_BLOCKED"
  | "CATEGORY_MISMATCH"
  | "REQUIRED_FEATURE_MISSING"
  | "OUT_OF_STOCK"
  | "CURRENCY_MISMATCH";

export type PolicyResult = {
  allowed: boolean;
  code: PolicyCode;
  violations: string[];
  totalAmount: number;
};
