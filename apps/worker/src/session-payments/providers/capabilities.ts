import {isPayPalSupportedCurrency} from "./paypal";
import type {PaymentCapability,PaymentCapabilityContext,PaymentProviderName,PaymentProviderSelection} from "./types";

export type CapabilityEnv={
  PAYMENT_PROVIDER?:string;
  PAYMENT_PROVIDER_ORDER?:string;
  PAYPAL_CLIENT_ID?:string;
  PAYPAL_CLIENT_SECRET?:string;
  PAYPAL_ACCOUNT_COUNTRY?:string;
  PAYPAL_ACCEPTED_CURRENCIES?:string;
  PAYPAL_ALLOWED_BUYER_COUNTRIES?:string;
  PAYPAL_ALLOWED_MERCHANT_COUNTRIES?:string;
  RAZORPAY_KEY_ID?:string;
  RAZORPAY_KEY_SECRET?:string;
  RAZORPAY_ACCOUNT_COUNTRY?:string;
  RAZORPAY_ACCEPTED_CURRENCIES?:string;
  RAZORPAY_ALLOWED_BUYER_COUNTRIES?:string;
  RAZORPAY_ALLOWED_MERCHANT_COUNTRIES?:string;
};

const list=(value?:string)=>{
  if(!value?.trim()) return null;
  return value.split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
};
const allowed=(value:string,listValue?:string)=>{
  const xs=list(listValue);
  return !xs || xs.includes(value.toUpperCase());
};

export function evaluatePaymentCapability(
  provider:PaymentProviderName,
  env:CapabilityEnv,
  context:PaymentCapabilityContext
):PaymentCapability{
  const currency=context.currency.toUpperCase();
  const buyerCountry=context.buyerCountry.toUpperCase();
  const merchantCountry=context.merchantCountry.toUpperCase();
  const reasons:string[]=[];
  const warnings:string[]=[];

  if(provider==="paypal"){
    const configured=Boolean(env.PAYPAL_CLIENT_ID&&env.PAYPAL_CLIENT_SECRET);
    const acceptedCurrencies=list(env.PAYPAL_ACCEPTED_CURRENCIES);
    const railCurrency=isPayPalSupportedCurrency(currency);
    const merchantCurrency=!acceptedCurrencies || acceptedCurrencies.includes(currency);
    const countrySupported=allowed(buyerCountry,env.PAYPAL_ALLOWED_BUYER_COUNTRIES)
      && allowed(merchantCountry,env.PAYPAL_ALLOWED_MERCHANT_COUNTRIES);
    const accountCountry=env.PAYPAL_ACCOUNT_COUNTRY?.trim().toUpperCase()||null;

    if(!configured) reasons.push("PAYPAL_NOT_CONFIGURED");
    if(!railCurrency) reasons.push(`PAYPAL_RAIL_UNSUPPORTED_CURRENCY:${currency}`);
    if(!merchantCurrency) reasons.push(`PAYPAL_ACCOUNT_CURRENCY_NOT_ENABLED:${currency}`);
    if(!countrySupported) reasons.push(`PAYPAL_COUNTRY_POLICY_BLOCK:${buyerCountry}:${merchantCountry}`);
    if(!acceptedCurrencies && railCurrency)
      warnings.push("PAYPAL_ACCOUNT_CURRENCY_ACCEPTANCE_RUNTIME_CHECK");
    if(currency==="CNY" && accountCountry && accountCountry!=="CN")
      reasons.push("PAYPAL_CNY_REQUIRES_CHINA_RECEIVER");
    if(currency==="MYR" && accountCountry && accountCountry!=="MY")
      reasons.push("PAYPAL_MYR_REQUIRES_MALAYSIA_RECEIVER");
    if(currency==="BRL" && accountCountry && accountCountry!=="BR")
      warnings.push("PAYPAL_BRL_MAY_CONVERT_TO_PRIMARY_BALANCE");

    return {
      provider,configured,
      supported:configured&&railCurrency&&merchantCurrency&&countrySupported&&reasons.length===0,
      currencySupported:railCurrency&&merchantCurrency,countrySupported,accountCountry,
      acceptedCurrencies,reasons,warnings
    };
  }

  const configured=Boolean(env.RAZORPAY_KEY_ID&&env.RAZORPAY_KEY_SECRET);
  const acceptedCurrencies=list(env.RAZORPAY_ACCEPTED_CURRENCIES)??["INR"];
  const currencySupported=acceptedCurrencies.includes(currency);
  const countrySupported=allowed(buyerCountry,env.RAZORPAY_ALLOWED_BUYER_COUNTRIES)
    && allowed(merchantCountry,env.RAZORPAY_ALLOWED_MERCHANT_COUNTRIES);
  const accountCountry=env.RAZORPAY_ACCOUNT_COUNTRY?.trim().toUpperCase()||"IN";
  if(!configured) reasons.push("RAZORPAY_NOT_CONFIGURED");
  if(!currencySupported) reasons.push(`RAZORPAY_ACCOUNT_CURRENCY_NOT_ENABLED:${currency}`);
  if(!countrySupported) reasons.push(`RAZORPAY_COUNTRY_POLICY_BLOCK:${buyerCountry}:${merchantCountry}`);
  return {
    provider,configured,supported:configured&&currencySupported&&countrySupported,
    currencySupported,countrySupported,accountCountry,acceptedCurrencies,reasons,warnings
  };
}

export function selectPaymentProvider(
  env:CapabilityEnv,
  context:PaymentCapabilityContext
):PaymentProviderSelection{
  const configured=String(env.PAYMENT_PROVIDER??"auto").trim().toLowerCase();
  const forced=configured==="paypal"||configured==="razorpay" ? configured as PaymentProviderName : null;
  const order=(env.PAYMENT_PROVIDER_ORDER??"paypal,razorpay")
    .split(",").map(x=>x.trim().toLowerCase())
    .filter((x):x is PaymentProviderName=>x==="paypal"||x==="razorpay");
  const candidates=forced?[forced]:[...new Set(order.length?order:["paypal","razorpay"] as PaymentProviderName[])];
  const evaluated=candidates.map(p=>evaluatePaymentCapability(p,env,context));
  const selected=evaluated.find(x=>x.supported);
  if(!selected){
    const summary=evaluated.map(x=>`${x.provider}[${x.reasons.join("|")||"UNAVAILABLE"}]`).join(";");
    throw new Error(`NO_PAYMENT_RAIL_AVAILABLE:${context.currency}:${summary}`);
  }
  return {provider:selected.provider,selected,evaluated};
}
