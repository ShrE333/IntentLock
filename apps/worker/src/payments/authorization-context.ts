import type {CommerceProduct} from "../commerce/types";
import {assertPayeeIdentityStable,buildPayeeLockBinding,type PayeeLockEnv} from "../commerce/payee-lock";
import type {IntentWallet,WalletTransaction} from "../wallets/types";
import type {PaymentAuthorizationContext} from "./context-types";
import {assertFxQuoteUsable,createFxQuote,revalidateFxDrift,type FxEnv} from "./fx";
import {resolveRecipient,assertTrustedRecipient,type RecipientEnv} from './recipient-binding';

export type AuthorizationContextEnv=FxEnv & PayeeLockEnv & RecipientEnv & {
  COMMERCE_MERCHANT_COUNTRY?:string;
};

const country=(v:string|undefined,fallback:string)=>{
  const c=String(v??fallback).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c)?c:fallback;
};

export function transactionFromAuthorizationContext(
  product:CommerceProduct,
  context:PaymentAuthorizationContext
):WalletTransaction{
  return {
    productName:product.title,
    category:product.category,
    brand:product.brand,
    amount:context.walletAmount,
    currency:context.walletCurrency,
    quantity:1,
    features:product.features,
    presentmentAmount:context.presentmentAmount,
    presentmentCurrency:context.presentmentCurrency,
    buyerCountry:context.buyerCountry,
    merchantCountry:context.merchantCountry,
    fxQuoteId:context.fxQuote?.quoteId,
    fxRate:context.fxQuote?.rate,
    fxSource:context.fxQuote?.source,
    fxQuotedAt:context.fxQuote?.quotedAt,
    fxExpiresAt:context.fxQuote?.expiresAt,
    payeeProvider:context.payeeLock?.provider,
    payeeFingerprint:context.payeeLock?.fingerprint,
    recipientFingerprint:context.recipient?.fingerprint
  };
}

export async function authorizeProductContext(
  env:AuthorizationContextEnv,
  wallet:IntentWallet,
  product:CommerceProduct,
  connectorId?:string
){
  const presentmentCurrency=product.currency.trim().toUpperCase();
  const walletCurrency=wallet.currency.trim().toUpperCase();
  const fxQuote=await createFxQuote(env,presentmentCurrency,walletCurrency,product.price);
  const merchantCountry=country(product.merchantCountry??env.COMMERCE_MERCHANT_COUNTRY,"ZZ");
  const productWithCountry={...product,merchantCountry};
  const payeeLock=await buildPayeeLockBinding(env,productWithCountry);
  const recipient=connectorId?await resolveRecipient(env,connectorId,productWithCountry):null;
  const context:PaymentAuthorizationContext={
    version:"intentlock-payment-context-v1",
    buyerCountry:country(wallet.countryCode,"IN"),
    merchantCountry,
    walletAmount:fxQuote?.toAmount??product.price,
    walletCurrency,
    presentmentAmount:product.price,
    presentmentCurrency,
    fxQuote,
    createdAt:new Date().toISOString(),
    payeeLock,...(recipient?{recipient}:{})
  };
  const enriched:CommerceProduct={...productWithCountry,authorizationContext:context};
  return {product:enriched,context,transaction:transactionFromAuthorizationContext(enriched,context)};
}

export async function revalidateAuthorizedProduct(
  env:AuthorizationContextEnv,
  wallet:IntentWallet,
  boundProduct:CommerceProduct,
  freshProduct:CommerceProduct
){
  const context=boundProduct.authorizationContext;
  if(!context){
    // Legacy same-currency sessions created before FX context existed.
    const legacy=await authorizeProductContext(env,wallet,freshProduct);
    return {...legacy,legacy:true,fxDrift:{checked:false,driftBps:0,currentRate:legacy.context.fxQuote?.rate??1}};
  }

  if(context.walletCurrency!==wallet.currency.toUpperCase()) throw new Error("WALLET_CURRENCY_CHANGED_REAUTHORIZE");
  if(context.buyerCountry!==country(wallet.countryCode,"IN")) throw new Error("WALLET_COUNTRY_CHANGED_REAUTHORIZE");
  if(context.presentmentCurrency!==freshProduct.currency.toUpperCase()) throw new Error("COMMERCE_CURRENCY_CHANGED_REAUTHORIZE");
  if(Math.abs(context.presentmentAmount-freshProduct.price)>0.000001) throw new Error("COMMERCE_PRICE_CHANGED_REAUTHORIZE");

  const merchantCountry=country(freshProduct.merchantCountry??env.COMMERCE_MERCHANT_COUNTRY,"ZZ");
  if(merchantCountry!==context.merchantCountry) throw new Error("MERCHANT_COUNTRY_CHANGED_REAUTHORIZE");

  const freshWithCountry={...freshProduct,merchantCountry};
  await assertPayeeIdentityStable(env,context.payeeLock,freshWithCountry);
  if(context.recipient){
    const current=await assertTrustedRecipient(env,context.recipient);
    if(freshWithCountry.source?.provider!==current.catalogProvider||freshWithCountry.source?.payeeId!==current.catalogSellerId)
      throw new Error('RECIPIENT_CATALOG_IDENTITY_CHANGED');
  }

  assertFxQuoteUsable(context.fxQuote);
  const fxDrift=await revalidateFxDrift(env,context.fxQuote);
  const enriched:CommerceProduct={...freshWithCountry,authorizationContext:context};
  return {product:enriched,context,transaction:transactionFromAuthorizationContext(enriched,context),legacy:false,fxDrift};
}
