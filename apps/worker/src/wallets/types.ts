export type WalletDecision = "ALLOW" | "STEP_UP" | "BLOCK";

export type IntentWallet = {
  walletId: string;
  name: string;
  currency: string;
  countryCode?: string;
  totalAuthority: number;
  spentAmount: number;
  reservedAmount?: number;
  autoBuyLimit: number;
  maxSingleTransaction: number;
  allowedCategories: string[];
  allowedBrands: string[];
  blockedBrands: string[];
  requiredFeatures: string[];
  excludedConditions?: ("NEW"|"USED"|"REFURBISHED")[];
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

  // V11.0.1: the wallet evaluates in its own authority currency, while these
  // fields bind the exact merchant/payment facts that produced that amount.
  presentmentAmount?: number;
  presentmentCurrency?: string;
  buyerCountry?: string;
  merchantCountry?: string;
  fxQuoteId?: string;
  fxRate?: number;
  fxSource?: string;
  fxQuotedAt?: string;
  fxExpiresAt?: string;

  // V11.2: stable payee identity binding. These are optional so old sessions
  // preserve their historical quote hashes.
  payeeProvider?: string;
  payeeFingerprint?: string;
  recipientFingerprint?: string;
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
