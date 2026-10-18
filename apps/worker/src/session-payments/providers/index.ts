import {createSessionRazorpayLink} from "../razorpay";
import {createPayPalOrder,isPayPalSupportedCurrency} from "./paypal";
import {selectPaymentProvider,type CapabilityEnv} from "./capabilities";
import type {CreateCheckoutInput,PaymentCheckout,PaymentProviderName} from "./types";

export type PaymentProviderEnv = CapabilityEnv & {
  PAYPAL_ENV?: string;
  PAYPAL_WEBHOOK_ID?: string;
  PAYPAL_RETURN_BASE_URL?: string;
};

// Retained for backwards-compatible callers/tests. New purchase execution uses
// selectPaymentProvider(), which evaluates credentials, currency and country.
export function activePaymentProvider(env:PaymentProviderEnv,currency?:string):PaymentProviderName{
  const configured=String(env.PAYMENT_PROVIDER??"auto").toLowerCase();
  if(configured==="razorpay") return "razorpay";
  if(configured==="paypal") return "paypal";
  return isPayPalSupportedCurrency(String(currency??"USD"))?"paypal":"razorpay";
}

export {selectPaymentProvider};

export async function createProviderCheckout(
  env:PaymentProviderEnv,
  input:CreateCheckoutInput,
  provider:PaymentProviderName
):Promise<PaymentCheckout>{
  if(provider==="paypal") return createPayPalOrder(env,input);

  const accepted=(env.RAZORPAY_ACCEPTED_CURRENCIES??"INR")
    .split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
  if(!accepted.includes(input.currency.toUpperCase()))
    throw new Error(`RAZORPAY_ACCOUNT_CURRENCY_NOT_ENABLED:${input.currency}`);

  const expiryMs=new Date(input.expiresAt).getTime();
  const link=await createSessionRazorpayLink(env,{
    sessionId:input.sessionId,walletId:input.walletId,
    authorizationId:input.authorizationId,quoteHash:input.quoteHash,
    productId:input.productId,productTitle:input.productTitle,
    amount:input.amount,currency:input.currency.toUpperCase(),
    idempotencyKey:input.idempotencyKey,expireBy:Math.floor(expiryMs/1000)
  });

  return {
    provider:"razorpay",providerOrderId:link.id,checkoutUrl:link.short_url,
    status:link.status,expiresAt:link.expire_by?new Date(link.expire_by*1000).toISOString():input.expiresAt,
    referenceId:link.reference_id
  };
}
