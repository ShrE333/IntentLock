export type WalletDecision = "ALLOW" | "STEP_UP" | "BLOCK";

export type IntentWallet = {
  walletId: string;
  name: string;
  currency: string;
  totalAuthority: number;
  spentAmount: number;
  autoBuyLimit: number;
  maxSingleTransaction: number;
  allowedCategories: string[];
  allowedBrands: string[];
  blockedBrands: string[];
  requiredFeatures: string[];
  validUntil: string;
  status: "ACTIVE" | "REVOKED";
};

export type WalletTransaction = {
  productName?: string;
  category: string;
  brand: string;
  amount: number;
  currency: string;
  quantity: number;
  features: string[];
};

export type WalletEvaluation = {
  decision: WalletDecision;
  violations: string[];
  reasons: string[];
  remainingAuthority: number;
  requestedAmount: number;
  additionalAuthorityRequired: number;
  canAutoExecute: boolean;
  requiresHumanApproval: boolean;
};
