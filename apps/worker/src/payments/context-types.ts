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
};
