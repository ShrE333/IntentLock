export type PaymentProviderName = "paypal" | "razorpay";

export type PaymentCapabilityContext={
  amount:number;
  currency:string;
  walletCurrency:string;
  buyerCountry:string;
  merchantCountry:string;
};

export type PaymentCapability={
  provider:PaymentProviderName;
  configured:boolean;
  supported:boolean;
  currencySupported:boolean;
  countrySupported:boolean;
  accountCountry:string|null;
  acceptedCurrencies:string[]|null;
  reasons:string[];
  warnings:string[];
};

export type PaymentProviderSelection={
  provider:PaymentProviderName;
  selected:PaymentCapability;
  evaluated:PaymentCapability[];
};

export type PaymentCheckout = {
  providerResponse?:unknown;
  provider: PaymentProviderName;
  providerOrderId: string;
  checkoutUrl: string;
  status: string;
  expiresAt: string | null;
  referenceId: string | null;
};

export type PaymentAuthorization = {
  providerResponse?:unknown;
  provider: PaymentProviderName;
  providerOrderId: string;
  providerAuthorizationId: string;
  status: string;
  amount: number;
  currency: string;
};

export type PaymentCaptureRequest = {
  providerResponse?:unknown;
  provider: PaymentProviderName;
  providerOrderId: string;
  providerAuthorizationId: string;
  providerCaptureId: string | null;
  status: string;
  amount: number;
  currency: string;
};

export type CreateCheckoutInput = {
  onProviderResponse?:(raw:unknown)=>Promise<void>;
  expectedRecipient?:import('../../payments/recipient-binding').RecipientBinding;
  sessionId: string;
  walletId: string;
  authorizationId: string | null;
  quoteHash: string;
  productId: string;
  productTitle: string;
  merchant: string;
  merchantCountry: string;
  buyerCountry: string;
  walletAmount: number;
  walletCurrency: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  expiresAt: string;
};
