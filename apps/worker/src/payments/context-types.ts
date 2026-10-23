export type FxQuote = {
  quoteId:string;
  fromCurrency:string;
  toCurrency:string;
  rate:number;
  fromAmount:number;
  toAmount:number;
  source:string;
  quotedAt:string;
  expiresAt:string;
};

export type PayeeLockBinding = {
  provider:string;
  payeeId:string;
  payeeType:string;
  merchantLabel:string;
  merchantCountry:string;
  fingerprint:string;
  mode:"observe"|"enforce";
  trustStatus:"TRUSTED"|"UNREGISTERED"|"REGISTRY_EMPTY";
  trustedLabel:string|null;
};

export type PaymentAuthorizationContext = {
  version:"intentlock-payment-context-v1";
  buyerCountry:string;
  merchantCountry:string;
  walletAmount:number;
  walletCurrency:string;
  presentmentAmount:number;
  presentmentCurrency:string;
  fxQuote:FxQuote|null;
  createdAt:string;

  // V11.2 PayeeLock: structured payee identity is bound into the exact
  // authorization context and revalidated before money moves.
  payeeLock?:PayeeLockBinding;
  recipient?:import('./recipient-binding').RecipientBinding;
};
