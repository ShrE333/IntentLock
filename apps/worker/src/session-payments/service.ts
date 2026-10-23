import {canonicalWalletTransaction,sha256Hex} from "../wallets/crypto";
import {evaluateWalletTransaction} from "../wallets/policy";
import {getWallet} from "../wallets/repository";
import {getSession,addEvent} from "../sessions/repository";
import {verifyRazorpayWebhook} from "../payments/webhook";
import {sha256Hex as hashWebhook} from "../db/audit";
import {buildSessionPaymentIdempotencyKey} from "./crypto";
import {SessionPaymentLock} from "./lock";
import {
  applyWalletSpendOnce,
  claimSessionWebhook,
  consumeOneTimeAuthorization,
  findWhatsappChatForSession,
  getSessionPayment,
  getProofReceipt,
  getVerifiedPayPalWebhook,
  getSessionPaymentByCaptureId,
  getSessionPaymentByProviderOrderId,
  markPayPalAuthorized,
  markPayPalCaptureRequested,
  markSessionPaymentCaptured,
  markSessionPaymentCreationFailed,
  markSessionPaymentFailed,
  markSessionPaymentPending,
  persistSessionPaymentCheckout,
  releaseOneTimeAuthorization,
  reserveSessionPayment
} from "./repository";
import {appendSessionAuditEvent,mirrorSessionTraceToAudit} from "./audit";
import {createProofReceipt} from "./proof";
import {sendWahaText} from "../whatsapp/waha-client";
import {getCommerceConnectors} from "../commerce/registry";
import {createProviderCheckout,selectPaymentProvider,type PaymentProviderEnv} from "./providers";
import {
  authorizePayPalOrder,
  capturePayPalAuthorization,
  extractPayPalWebhookIds,
  verifyPayPalWebhook,
  type PayPalEnv
} from "./providers/paypal";
import type {PaymentProviderName} from "./providers/types";
import type {CommerceProduct} from "../commerce/types";
import type {WalletTransaction} from "../wallets/types";
import {revalidateAuthorizedProduct,transactionFromAuthorizationContext} from "../payments/authorization-context";
import {getStepUpRequest} from '../wallets/stepup-repository';
import {reserveWalletAuthority,beginProviderOperation,confirmProviderOperation,releaseUnusedReservation,releaseVerifiedDeniedCapture} from './reservations';
import {assessAndTighten} from '../risk/tighten';
import type {AccessContextEnv} from '../access/identity';
import {assertExecutableCommerce,assertTrustedRecipient,recipientEnvironment} from '../payments/recipient-binding';
import {verifyProviderRecipient} from './recipient-evidence';
import {recordPayPalResponse} from './response-evidence';

export type SessionPaymentEnv=PaymentProviderEnv & PayPalEnv & AccessContextEnv & {
  PURCHASE_QUEUE?:{send(job:PayPalSettlementJob):Promise<unknown>};
  DATABASE_URL?:string;
  APPROVAL_SIGNING_SECRET?:string;
  UPSTASH_REDIS_REST_URL?:string;
  UPSTASH_REDIS_REST_TOKEN?:string;
  RAZORPAY_WEBHOOK_SECRET?:string;

  COMMERCE_CATALOG_URL?:string;
  COMMERCE_MERCHANT_COUNTRY?:string;
  FX_PROVIDER?:string;
  FX_RATES_JSON?:string;
  FX_QUOTE_TTL_SECONDS?:string;
  FX_MAX_DRIFT_BPS?:string;
  FX_REVALIDATE?:string;
  SHOPIFY_STORE_DOMAIN?:string;
  SHOPIFY_STOREFRONT_PUBLIC_TOKEN?:string;
  SHOPIFY_STOREFRONT_PRIVATE_TOKEN?:string;
  SHOPIFY_STOREFRONT_API_VERSION?:string;

  WAHA_BASE_URL?:string;
  WAHA_API_KEY?:string;
};

function requireDb(env:SessionPaymentEnv){
  if(!env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  return env.DATABASE_URL;
}

function transactionFor(product:CommerceProduct){
  return {
    productName:product.title,
    category:product.category,
    brand:product.brand,
    amount:product.price,
    currency:product.currency.toUpperCase(),
    quantity:1,
    features:product.features
  };
}

async function revalidateCommerceAndAuthority(
  env:SessionPaymentEnv,
  sessionId:string,
  expectedQuoteHash?:string|null
){
  const db=requireDb(env);
  const session=await getSession(db,sessionId);
  if(!session) throw new Error("SESSION_NOT_FOUND");
  if(!session.selectedProduct) throw new Error("SELECTED_PRODUCT_NOT_FOUND");

  const wallet=await getWallet(db,session.walletId);
  if(!wallet) throw new Error("WALLET_NOT_FOUND");

  const connector=getCommerceConnectors(env)
    .find(c=>c.info().id===session.connectorId);
  if(!connector) throw new Error("COMMERCE_CONNECTOR_NOT_AVAILABLE_AT_PAYMENT");

  // Every provider is re-read at execution time. Shopify is no longer special.
  const freshProduct=await connector.getProduct(session.selectedProduct.id);
  if(!freshProduct) throw new Error("COMMERCE_PRODUCT_NO_LONGER_AVAILABLE");
  if(freshProduct.quantityAvailable<=0) throw new Error("COMMERCE_PRODUCT_OUT_OF_STOCK");

  let selectedTx:WalletTransaction;
  let freshTx:WalletTransaction;
  let normalizedFreshProduct=freshProduct;
  let fxDrift:{checked:boolean;driftBps:number;currentRate:number}|null=null;

  if(session.selectedProduct.authorizationContext){
    selectedTx=transactionFromAuthorizationContext(
      session.selectedProduct,session.selectedProduct.authorizationContext
    );
    const validated=await revalidateAuthorizedProduct(
      env,wallet,session.selectedProduct,freshProduct
    );
    normalizedFreshProduct=validated.product;
    freshTx=validated.transaction;
    fxDrift=validated.fxDrift;
  }else{
    // Backward compatibility for V10/V11.0 sessions created before FX context existed.
    selectedTx=transactionFor(session.selectedProduct);
    freshTx=transactionFor(freshProduct);
  }

  const selectedQuoteHash=await sha256Hex(canonicalWalletTransaction(selectedTx));
  const freshQuoteHash=await sha256Hex(canonicalWalletTransaction(freshTx));
  const expected=expectedQuoteHash??selectedQuoteHash;

  if(freshQuoteHash!==expected){
    await addEvent(db,sessionId,"COMMERCE_QUOTE_CHANGED",{
      connectorId:session.connectorId,
      productId:session.selectedProduct.id,
      expectedQuoteHash:expected,
      currentQuoteHash:freshQuoteHash,
      previous:{price:session.selectedProduct.price,currency:session.selectedProduct.currency},
      current:{price:freshProduct.price,currency:freshProduct.currency},
      fxDrift
    });
    await appendSessionAuditEvent(db,sessionId,"COMMERCE_QUOTE_CHANGED",{
      connectorId:session.connectorId,
      productId:session.selectedProduct.id,
      expectedQuoteHash:expected,
      currentQuoteHash:freshQuoteHash
    });
    throw new Error("COMMERCE_QUOTE_CHANGED_REAUTHORIZE");
  }

  let evaluation=evaluateWalletTransaction(wallet,freshTx);
  const tightened=await assessAndTighten(db,{
    sessionId,walletId:wallet.walletId,agentId:'intentlock-purchase-agent',merchant:normalizedFreshProduct.merchant,
    amount:freshTx.amount,currency:freshTx.currency,policyDecision:evaluation.decision,
    selectedMerchantMessage:normalizedFreshProduct.merchantMessage
  },evaluation);
  evaluation=tightened.evaluation;
  // Risk-driven consent is still required when monetary policy alone says ALLOW.
  if(evaluation.decision==='ALLOW'&&session.selectedDecision==='STEP_UP'&&session.stepUpRequestId){
    // Preserve historical RAISE_LIMIT sessions, but never infer risk consent
    // merely because their amount falls below the current autonomous limit.
    const request=await getStepUpRequest(db,session.stepUpRequestId);
    if(request?.status!=='LIMIT_RAISED')evaluation={...evaluation,decision:'STEP_UP',canAutoExecute:false,requiresHumanApproval:true};
  }
  if(evaluation.decision==="BLOCK"){
    await addEvent(db,sessionId,"PAYMENT_AUTHORITY_RECHECK_BLOCKED",{
      violations:evaluation.violations
    });
    await appendSessionAuditEvent(db,sessionId,"PAYMENT_AUTHORITY_RECHECK_BLOCKED",{
      violations:evaluation.violations
    });
    throw new Error(`AUTHORITY_CHANGED:${evaluation.violations.join(",")}`);
  }

  await addEvent(db,sessionId,"COMMERCE_QUOTE_REVALIDATED",{
    connectorId:session.connectorId,
    productId:normalizedFreshProduct.id,
    price:normalizedFreshProduct.price,
    currency:normalizedFreshProduct.currency,
    walletAmount:freshTx.amount,
    walletCurrency:freshTx.currency,
    fxDrift,
    quoteHash:freshQuoteHash
  });
  await appendSessionAuditEvent(db,sessionId,"COMMERCE_QUOTE_REVALIDATED",{
    connectorId:session.connectorId,
    productId:normalizedFreshProduct.id,
    price:normalizedFreshProduct.price,
    currency:normalizedFreshProduct.currency,
    walletAmount:freshTx.amount,
    walletCurrency:freshTx.currency,
    fxDrift,
    quoteHash:freshQuoteHash
  });

  return {
    session,wallet,freshProduct:normalizedFreshProduct,freshTx,evaluation,
    quoteHash:freshQuoteHash,
    authorizationContext:session.selectedProduct.authorizationContext??null
  };
}

async function consumeExecutionAuthorityIfNeeded(
  db:string,
  input:Awaited<ReturnType<typeof revalidateCommerceAndAuthority>>
){
  if(input.evaluation.decision!=="STEP_UP"){
    await addEvent(db,input.session.sessionId,"PAYMENT_AUTHORITY_RECHECK_ALLOWED",{
      decision:input.evaluation.decision,
      quoteHash:input.quoteHash,
      amount:input.freshTx.amount,
      currency:input.freshTx.currency
    });
    await appendSessionAuditEvent(db,input.session.sessionId,"PAYMENT_AUTHORITY_RECHECK_ALLOWED",{
      decision:input.evaluation.decision,
      quoteHash:input.quoteHash,
      amount:input.freshTx.amount,
      currency:input.freshTx.currency
    });
    return null;
  }

  if(!input.session.authorizationId)
    throw new Error("ONE_TIME_AUTHORIZATION_REQUIRED");

  const consumed=await consumeOneTimeAuthorization(db,{
    authorizationId:input.session.authorizationId,
    walletId:input.wallet.walletId,
    sessionId:input.session.sessionId,
    quoteHash:input.quoteHash,
    amount:input.freshTx.amount
  });

  if(!consumed.consumed) throw new Error(consumed.reason);

  await addEvent(db,input.session.sessionId,"ONE_TIME_AUTHORIZATION_CONSUMED",{
    authorizationId:input.session.authorizationId,
    quoteHash:input.quoteHash,
    amount:input.freshTx.amount,
    currency:input.freshTx.currency,
    reason:consumed.reason
  });
  await appendSessionAuditEvent(db,input.session.sessionId,"ONE_TIME_AUTHORIZATION_CONSUMED",{
    authorizationId:input.session.authorizationId,
    quoteHash:input.quoteHash,
    amount:input.freshTx.amount,
    currency:input.freshTx.currency,
    tokenHash:consumed.token_hash
  });

  return input.session.authorizationId;
}

export async function createPaymentForSession(env:SessionPaymentEnv,sessionId:string){
  const db=requireDb(env);
  const existing=await getSessionPayment(db,sessionId);
  if(existing?.providerOrderId){
    return {duplicate:true,payment:existing,paymentLink:existing};
  }
  if(!env.APPROVAL_SIGNING_SECRET)throw new Error('APPROVAL_SIGNING_SECRET_NOT_CONFIGURED');

  const session=await getSession(db,sessionId);
  if(!session) throw new Error("SESSION_NOT_FOUND");
  if(session.status==="CAPTURED") return {duplicate:true,payment:existing,paymentLink:existing};
  if(session.status!=="READY_TO_PAY")
    throw new Error(`SESSION_NOT_READY_TO_PAY:${session.status}`);

  await mirrorSessionTraceToAudit(db,sessionId);

  const checked=await revalidateCommerceAndAuthority(env,sessionId,null);
  assertExecutableCommerce(checked.session.connectorId,recipientEnvironment(env));
  const amount=checked.freshProduct.price;
  const currency=checked.freshProduct.currency.toUpperCase();
  const paymentContext={
    amount,currency,
    walletCurrency:checked.wallet.currency.toUpperCase(),
    buyerCountry:checked.authorizationContext?.buyerCountry??checked.wallet.countryCode??"IN",
    merchantCountry:checked.authorizationContext?.merchantCountry??checked.freshProduct.merchantCountry??env.COMMERCE_MERCHANT_COUNTRY??"ZZ"
  };
  const railSelection=selectPaymentProvider(env,paymentContext);
  const provider=railSelection.provider;
  const expectedRecipient=provider==='paypal'?await assertTrustedRecipient(env,checked.authorizationContext?.recipient):null;

  await addEvent(db,sessionId,"PAYMENT_RAIL_SELECTED",{
    provider,presentmentAmount:amount,presentmentCurrency:currency,
    walletAmount:checked.freshTx.amount,walletCurrency:checked.freshTx.currency,
    buyerCountry:paymentContext.buyerCountry,merchantCountry:paymentContext.merchantCountry,
    selected:railSelection.selected,evaluated:railSelection.evaluated
  });
  await appendSessionAuditEvent(db,sessionId,"PAYMENT_RAIL_SELECTED",{
    provider,presentmentAmount:amount,presentmentCurrency:currency,
    walletAmount:checked.freshTx.amount,walletCurrency:checked.freshTx.currency,
    buyerCountry:paymentContext.buyerCountry,merchantCountry:paymentContext.merchantCountry,
    selected:railSelection.selected
  });

  const idempotencyKey=await buildSessionPaymentIdempotencyKey({
    sessionId,walletId:checked.wallet.walletId,quoteHash:checked.quoteHash,
    amount,currency,provider
  });

  const lock=SessionPaymentLock.fromEnv(env);
  const acquired=await lock.claim(idempotencyKey,JSON.stringify({
    provider,sessionId,walletId:checked.wallet.walletId,
    quoteHash:checked.quoteHash,claimedAt:new Date().toISOString()
  }),900);

  if(!acquired){
    const afterClaim=await getSessionPayment(db,sessionId);
    if(afterClaim?.providerOrderId)
      return {duplicate:true,payment:afterClaim,paymentLink:afterClaim};
    throw new Error("SESSION_PAYMENT_ALREADY_IN_PROGRESS");
  }

  await reserveWalletAuthority(db,{
    sessionId,walletId:checked.wallet.walletId,quoteHash:checked.quoteHash,idempotencyKey,
    amount:checked.freshTx.amount,currency:checked.freshTx.currency,provider
  });
  const reservation=await reserveSessionPayment(db,{
    expectedRecipient,
    sessionId,walletId:checked.wallet.walletId,
    authorizationId:checked.session.authorizationId,
    quoteHash:checked.quoteHash,idempotencyKey,amount,currency,provider
  });

  if(reservation.providerOrderId){
    const already=await getSessionPayment(db,sessionId);
    if(already) return {duplicate:true,payment:already,paymentLink:already};
  }

  let consumedAuthorizationId:string|null=null;
  let providerCallStarted=false;

  try{
    // Razorpay links can be paid asynchronously, so one-time authority is
    // consumed before link creation. PayPal consumes it immediately before capture.
    if(provider==="razorpay"){
      consumedAuthorizationId=await consumeExecutionAuthorityIfNeeded(db,checked);
    }

    const walletExpiry=new Date(checked.wallet.validUntil).getTime();
    const expiryMs=Math.min(walletExpiry,Date.now()+20*60*1000);
    if(expiryMs-Date.now()<15*60*1000)
      throw new Error("WALLET_EXPIRES_TOO_SOON_FOR_PAYMENT");

    // From this point a provider-side object may exist even if the network
    // response is lost. Do not release one-time authority on ambiguous outcomes.
    await beginProviderOperation(db,sessionId,checked.quoteHash,'CHECKOUT');
    providerCallStarted=true;
    const checkout=await createProviderCheckout(env,{
      ...(provider==='paypal'?{onProviderResponse:async(raw:unknown)=>{
        const pending=await getSessionPayment(db,sessionId);if(!pending)throw new Error('SESSION_PAYMENT_NOT_FOUND');await recordPayPalResponse(env,pending,'ORDER',raw);
      }}:{}),
      ...(expectedRecipient?{expectedRecipient}:{}),
      sessionId,walletId:checked.wallet.walletId,
      authorizationId:checked.session.authorizationId,
      quoteHash:checked.quoteHash,
      productId:checked.freshProduct.id,
      productTitle:checked.freshProduct.title,
      merchant:checked.freshProduct.merchant,
      merchantCountry:paymentContext.merchantCountry,buyerCountry:paymentContext.buyerCountry,
      walletAmount:checked.freshTx.amount,walletCurrency:checked.freshTx.currency,
      amount,currency,idempotencyKey,
      expiresAt:new Date(expiryMs).toISOString()
    },provider);

    const persisted=await persistSessionPaymentCheckout(db,{
      expectedRecipient,
      sessionId,walletId:checked.wallet.walletId,
      authorizationId:checked.session.authorizationId,
      quoteHash:checked.quoteHash,idempotencyKey,
      provider:checkout.provider,providerOrderId:checkout.providerOrderId,
      referenceId:checkout.referenceId,checkoutUrl:checkout.checkoutUrl,
      amount,currency,status:checkout.status,expiresAt:checkout.expiresAt
    });

    if(provider==='paypal')await verifyProviderRecipient(env,persisted,'ORDER',{providerResponse:checkout.providerResponse});
    await confirmProviderOperation(db,sessionId,'CHECKOUT',checkout.providerOrderId);
    const sessionStatus=provider==="paypal"?"PAYPAL_APPROVAL_PENDING":"PAYMENT_PENDING";
    await markSessionPaymentPending(db,{
      sessionId,provider,quoteHash:checked.quoteHash,idempotencyKey,
      providerOrderId:checkout.providerOrderId,checkoutUrl:checkout.checkoutUrl,
      status:sessionStatus
    });

    await addEvent(db,sessionId,"PAYMENT_CHECKOUT_CREATED",{
      provider,providerOrderId:checkout.providerOrderId,
      amount,currency,walletAmount:checked.freshTx.amount,walletCurrency:checked.freshTx.currency,
      buyerCountry:paymentContext.buyerCountry,merchantCountry:paymentContext.merchantCountry,
      quoteHash:checked.quoteHash,idempotencyKey,capability:railSelection.selected
    });
    await appendSessionAuditEvent(db,sessionId,"PAYMENT_CHECKOUT_CREATED",{
      provider,providerOrderId:checkout.providerOrderId,
      amount,currency,walletAmount:checked.freshTx.amount,walletCurrency:checked.freshTx.currency,
      buyerCountry:paymentContext.buyerCountry,merchantCountry:paymentContext.merchantCountry,
      quoteHash:checked.quoteHash,idempotencyKey,authorizationId:checked.session.authorizationId,
      capability:railSelection.selected
    });

    if(provider==="paypal"){
      await addEvent(db,sessionId,"PAYPAL_BUYER_APPROVAL_REQUIRED",{
        providerOrderId:checkout.providerOrderId,
        note:"Order intent is AUTHORIZE. No capture has occurred."
      });
    }

    return {duplicate:false,payment:persisted,paymentLink:persisted};
  }catch(error){
    await markSessionPaymentCreationFailed(db,sessionId);
    const releasedUnused=!providerCallStarted&&await releaseUnusedReservation(db,sessionId);
    if(consumedAuthorizationId && releasedUnused)
      await releaseOneTimeAuthorization(db,consumedAuthorizationId,sessionId);
    await lock.release(idempotencyKey);
    throw error;
  }
}

// Backwards-compatible endpoint implementation.
export const createPaymentLinkForSession=createPaymentForSession;

export async function authorizePayPalForSession(env:SessionPaymentEnv,sessionId:string){
  const db=requireDb(env);
  const payment=await getSessionPayment(db,sessionId);
  if(!payment) throw new Error("SESSION_PAYMENT_NOT_FOUND");
  if(payment.provider!=="paypal") throw new Error("PAYMENT_PROVIDER_NOT_PAYPAL");
  if(!payment.providerOrderId) throw new Error("PAYPAL_ORDER_ID_MISSING");
  if(payment.providerAuthorizationId){
    return {duplicate:true,payment};
  }
  const currentSession=await getSession(db,sessionId);
  if(currentSession?.status!=='PAYPAL_APPROVAL_PENDING') throw new Error('SESSION_NOT_AWAITING_PAYPAL_APPROVAL');

  // Revalidate policy + quote immediately before placing the PayPal hold.
  const checked=await revalidateCommerceAndAuthority(env,sessionId,payment.quoteHash??undefined);
  assertExecutableCommerce(checked.session.connectorId,recipientEnvironment(env));
  const expectedRecipient=await assertTrustedRecipient(env,checked.authorizationContext?.recipient);
  if(payment.expectedRecipient?.fingerprint!==expectedRecipient.fingerprint)throw new Error('PAYMENT_RECIPIENT_BINDING_MISMATCH');
  await verifyProviderRecipient(env,payment,'PRE_AUTHORIZE');
  await consumeExecutionAuthorityIfNeeded(db,checked);
  await beginProviderOperation(db,sessionId,checked.quoteHash,'AUTHORIZE');
  const auth=await authorizePayPalOrder(
    env,payment.providerOrderId,
    `${sessionId}:${payment.providerOrderId}:authorize`,undefined,raw=>recordPayPalResponse(env,payment,'AUTHORIZE',raw)
  );

  if(!Number.isFinite(auth.amount)||auth.amount<=0||auth.amount!==payment.amount)
    throw new Error(`PAYPAL_AUTH_AMOUNT_MISMATCH:${auth.amount}:${payment.amount}`);
  if(auth.currency!==payment.currency)
    throw new Error(`PAYPAL_AUTH_CURRENCY_MISMATCH:${auth.currency}:${payment.currency}`);

  await verifyProviderRecipient(env,payment,'AUTHORIZE',{authorizationId:auth.providerAuthorizationId,providerResponse:auth.providerResponse});
  await markPayPalAuthorized(db,{
    sessionId,providerOrderId:payment.providerOrderId,
    providerAuthorizationId:auth.providerAuthorizationId,
    status:"AUTHORIZED"
  });

  await confirmProviderOperation(db,sessionId,'AUTHORIZE',payment.providerOrderId,auth.providerAuthorizationId);
  await addEvent(db,sessionId,"PAYPAL_AUTHORIZED",{
    providerOrderId:payment.providerOrderId,
    providerAuthorizationId:auth.providerAuthorizationId,
    amount:payment.amount,currency:payment.currency,
    quoteHash:checked.quoteHash,
    note:"Funds authorized/held only; capture not yet trusted."
  });
  await appendSessionAuditEvent(db,sessionId,"PAYPAL_AUTHORIZED",{
    providerOrderId:payment.providerOrderId,
    providerAuthorizationId:auth.providerAuthorizationId,
    amount:payment.amount,currency:payment.currency,
    quoteHash:checked.quoteHash
  });

  const {providerResponse:_response,...authorization}=auth;
  return {duplicate:false,authorization,payment:await getSessionPayment(db,sessionId)};
}

export async function capturePayPalForSession(env:SessionPaymentEnv,sessionId:string){
  const db=requireDb(env);
  const payment=await getSessionPayment(db,sessionId);
  if(!payment) throw new Error("SESSION_PAYMENT_NOT_FOUND");
  if(payment.provider!=="paypal") throw new Error("PAYMENT_PROVIDER_NOT_PAYPAL");
  if(!payment.providerOrderId) throw new Error("PAYPAL_ORDER_ID_MISSING");
  if(!payment.providerAuthorizationId) throw new Error("PAYPAL_AUTHORIZATION_ID_MISSING");

  const session=await getSession(db,sessionId);
  if(session?.status==="CAPTURED") return {duplicate:true,payment};
  if(payment.providerCaptureId && session?.status==="CAPTURE_PENDING")
    return {duplicate:true,payment};
  if(!env.APPROVAL_SIGNING_SECRET)throw new Error('APPROVAL_SIGNING_SECRET_NOT_CONFIGURED');
  if(!session||!['AUTHORIZED','CAPTURE_PENDING'].includes(session.status))throw new Error('SESSION_NOT_AUTHORIZED_FOR_CAPTURE');

  // Final deterministic revalidation happens AFTER PayPal authorization and
  // immediately BEFORE capture.
  const checked=await revalidateCommerceAndAuthority(env,sessionId,payment.quoteHash??undefined);
  assertExecutableCommerce(checked.session.connectorId,recipientEnvironment(env));
  const expectedRecipient=await assertTrustedRecipient(env,checked.authorizationContext?.recipient);
  if(payment.expectedRecipient?.fingerprint!==expectedRecipient.fingerprint)throw new Error('PAYMENT_RECIPIENT_BINDING_MISMATCH');
  await verifyProviderRecipient(env,payment,'PRE_CAPTURE');
  {
    await consumeExecutionAuthorityIfNeeded(db,checked);

    // Once the capture request starts, its outcome can be ambiguous on a
    // transport failure. Keep one-time authority consumed rather than risk reuse.
    // Persist authority exercise before the provider call, including when its response is lost.
    await addEvent(db,sessionId,"PAYPAL_CAPTURE_INITIATED",{
      providerOrderId:payment.providerOrderId,
      providerAuthorizationId:payment.providerAuthorizationId,
      amount:payment.amount,currency:payment.currency
    });
    await beginProviderOperation(db,sessionId,checked.quoteHash,'CAPTURE');
    const capture=await capturePayPalAuthorization(
      env,payment.providerAuthorizationId,payment.providerOrderId,
      `${sessionId}:${payment.providerAuthorizationId}:capture`,undefined,raw=>recordPayPalResponse(env,payment,'CAPTURE',raw),{amount:payment.amount,currency:payment.currency}
    );

    if(!Number.isFinite(capture.amount)||capture.amount<=0||capture.amount!==payment.amount)
      throw new Error(`PAYPAL_CAPTURE_AMOUNT_MISMATCH:${capture.amount}:${payment.amount}`);
    if(capture.currency!==payment.currency)
      throw new Error(`PAYPAL_CAPTURE_CURRENCY_MISMATCH:${capture.currency}:${payment.currency}`);

    await markPayPalCaptureRequested(db,{
      sessionId,providerCaptureId:capture.providerCaptureId,status:"CAPTURE_REQUESTED"
    });
    await verifyProviderRecipient(env,payment,'CAPTURE',{captureId:capture.providerCaptureId,providerResponse:capture.providerResponse});
    await confirmProviderOperation(db,sessionId,'CAPTURE',payment.providerOrderId,payment.providerAuthorizationId,capture.providerCaptureId);
    await addEvent(db,sessionId,"PAYPAL_CAPTURE_REQUESTED",{
      providerAuthorizationId:payment.providerAuthorizationId,
      providerCaptureId:capture.providerCaptureId,
      providerResponseStatus:capture.status,
      amount:payment.amount,currency:payment.currency,
      trustedCapturedState:false,
      note:"IntentLock waits for a verified PAYMENT.CAPTURE.COMPLETED webhook."
    });
    await appendSessionAuditEvent(db,sessionId,"PAYPAL_CAPTURE_REQUESTED",{
      providerAuthorizationId:payment.providerAuthorizationId,
      providerCaptureId:capture.providerCaptureId,
      providerResponseStatus:capture.status,
      amount:payment.amount,currency:payment.currency,
      trustedCapturedState:false
    });

    const {providerResponse:_response,...publicCapture}=capture;
    return {duplicate:false,capture:publicCapture,payment:await getSessionPayment(db,sessionId)};
  }
}

async function finishVerifiedCapture(
  env:SessionPaymentEnv,
  input:{
    provider:PaymentProviderName;
    sessionId:string;
    providerOrderId:string;
    providerPaymentId:string|null;
    amount:number;
    currency:string;
    verifiedPayPalPayloadHash?:string;
    verifiedWebhookPayloadHash?:string;
  },
  stage?:(name:string,data?:Record<string,unknown>)=>void
){
  const db=requireDb(env);
  const session=await getSession(db,input.sessionId);
  if(!session) throw new Error("SESSION_NOT_FOUND");
  const payment=await getSessionPayment(db,input.sessionId);
  if(!payment) throw new Error("SESSION_PAYMENT_NOT_FOUND");

  if(payment.sessionId!==session.sessionId || payment.walletId!==session.walletId ||
     payment.provider!==input.provider || payment.providerOrderId!==input.providerOrderId)
    throw new Error("PAYMENT_IDENTITY_MISMATCH");
  if(Math.abs(input.amount-payment.amount)>0.0001)
    throw new Error(`PAYMENT_AMOUNT_MISMATCH:${input.amount}:${payment.amount}`);
  if(input.currency.toUpperCase()!==payment.currency.toUpperCase())
    throw new Error(`PAYMENT_CURRENCY_MISMATCH:${input.currency}:${payment.currency}`);

  const authContext=session.selectedProduct?.authorizationContext??null;
  const walletSpendAmount=authContext?.walletAmount??payment.amount;
  const walletSpendCurrency=authContext?.walletCurrency??payment.currency;

  stage?.("PAYPAL_WALLET_SETTLEMENT",{status:"started"});
  const spend=await applyWalletSpendOnce(db,{
    sessionId:session.sessionId,walletId:session.walletId,
    amount:walletSpendAmount,currency:walletSpendCurrency,
    provider:input.provider,providerLinkId:input.providerOrderId,
    providerPaymentId:input.providerPaymentId,
    ...(input.verifiedPayPalPayloadHash?{verifiedPayPalPayloadHash:input.verifiedPayPalPayloadHash}:{}),
    ...(input.verifiedWebhookPayloadHash?{verifiedWebhookPayloadHash:input.verifiedWebhookPayloadHash}:{})
  });

  stage?.("PAYPAL_WALLET_SETTLEMENT",{status:"completed",applied:spend.applied,ledgerId:spend.ledgerId});

  stage?.("PAYPAL_PAYMENT_CAPTURED_EVENT");
  await addEvent(db,session.sessionId,"PAYMENT_CAPTURED",{
    provider:input.provider,providerOrderId:input.providerOrderId,
    providerPaymentId:input.providerPaymentId,amount:payment.amount,currency:payment.currency,
    walletAmount:walletSpendAmount,walletCurrency:walletSpendCurrency,walletSpendApplied:spend.applied
  });
  await appendSessionAuditEvent(db,session.sessionId,"PAYMENT_CAPTURED",{
    provider:input.provider,providerOrderId:input.providerOrderId,
    providerPaymentId:input.providerPaymentId,amount:payment.amount,currency:payment.currency,
    walletAmount:walletSpendAmount,walletCurrency:walletSpendCurrency
  });

  stage?.("PAYPAL_WALLET_SPEND_EVENT");
  await addEvent(db,session.sessionId,"WALLET_SPEND_APPLIED",{
    ledgerId:spend.ledgerId,amount:walletSpendAmount,currency:walletSpendCurrency,
    spentAmount:spend.spentAmount,remainingAuthority:spend.remainingAuthority,replaySafe:true
  });
  await appendSessionAuditEvent(db,session.sessionId,"WALLET_SPEND_APPLIED",{
    ledgerId:spend.ledgerId,amount:walletSpendAmount,currency:walletSpendCurrency,
    spentAmount:spend.spentAmount,remainingAuthority:spend.remainingAuthority,replaySafe:true
  });

  stage?.("PAYPAL_SESSION_CAPTURE_STARTED");
  await markSessionPaymentCaptured(db,{
    sessionId:session.sessionId,provider:input.provider,
    providerOrderId:input.providerOrderId,providerPaymentId:input.providerPaymentId,
    amount:payment.amount,currency:payment.currency
  });

  stage?.("PAYPAL_SESSION_CAPTURED");
  if(!env.APPROVAL_SIGNING_SECRET)
    throw new Error("APPROVAL_SIGNING_SECRET_NOT_CONFIGURED");

  stage?.("PAYPAL_PROOF_STARTED");
  const receipt=await createProofReceipt(db,env.APPROVAL_SIGNING_SECRET,session.sessionId);
  await addEvent(db,session.sessionId,"PROOF_RECEIPT_CREATED",{
    receiptId:receipt.receiptId,proofHash:receipt.proofHash
  });

  stage?.("PAYPAL_PROOF_CREATED",{receiptId:receipt.receiptId});

  if(env.WAHA_BASE_URL&&env.WAHA_API_KEY){
    const chat=await findWhatsappChatForSession(db,session.sessionId);
    if(chat){
      try{
        await sendWahaText({
          baseUrl:env.WAHA_BASE_URL,apiKey:env.WAHA_API_KEY,
          session:chat.wahaSession,chatId:chat.chatId,
          text:`✅ *Payment captured*\n\nIntentLock verified the ${input.provider.toUpperCase()} webhook and updated your Intent Wallet.\n\nPayment: ${payment.currency} ${payment.amount.toFixed(2)}\nWallet debit: ${walletSpendCurrency} ${walletSpendAmount.toFixed(2)}\nRemaining authority: ${walletSpendCurrency} ${spend.remainingAuthority.toFixed(2)}\n\n🧾 Proof Receipt\n${receipt.receiptId}\n\nSession:\n${session.sessionId}`
        });
      }catch(error){console.error("WAHA payment confirmation failed",error);}
    }
  }

  return {spend,receipt};
}

export type PayPalSettlementJob={
  kind:"FINALIZE_PAYPAL_CAPTURE";
  payloadHash:string;
};

type PayPalIds=ReturnType<typeof extractPayPalWebhookIds>;
type ExpectedPayment=NonNullable<Awaited<ReturnType<typeof getSessionPayment>>>;

function validatePayPalCapture(ids:PayPalIds,payment:ExpectedPayment){
  if(payment.provider!=="paypal") throw new Error("PAYMENT_PROVIDER_NOT_PAYPAL");
  if(!payment.providerOrderId || ids.orderId!==payment.providerOrderId)
    throw new Error("PAYPAL_ORDER_MISMATCH");
  if(!ids.captureId || (payment.providerCaptureId && ids.captureId!==payment.providerCaptureId))
    throw new Error("PAYPAL_CAPTURE_MISMATCH");
  if(!payment.providerAuthorizationId || ids.authorizationId!==payment.providerAuthorizationId)
    throw new Error("PAYPAL_AUTHORIZATION_MISMATCH");
  if(!Number.isFinite(ids.amount) || ids.amount<=0 || Math.abs(ids.amount-payment.amount)>0.0001)
    throw new Error("PAYPAL_CAPTURE_AMOUNT_MISMATCH");
  if(ids.currency!==payment.currency.toUpperCase())
    throw new Error("PAYPAL_CAPTURE_CURRENCY_MISMATCH");
}

function paypalProcessingLog(env:SessionPaymentEnv,context:Record<string,unknown>){
  let currentStage="PAYPAL_WEBHOOK_PAYMENT_LOOKUP";
  return {
    stage(name:string,data:Record<string,unknown>={}){
      currentStage=name;
      console.log(name,{...context,...data});
    },
    error(error:unknown){
      let message=error instanceof Error?error.message:String(error);
      for(const value of [env.DATABASE_URL,env.PAYPAL_CLIENT_SECRET,env.APPROVAL_SIGNING_SECRET]){
        if(value) message=message.replaceAll(value,"[REDACTED]");
      }
      console.error("PAYPAL_WEBHOOK_PROCESSING_ERROR",{...context,stage:currentStage,message});
    }
  };
}

async function settleVerifiedPayPalCapture(
  env:SessionPaymentEnv,payloadHash:string,ids:PayPalIds,payment:ExpectedPayment
){
  const db=requireDb(env);
  const log=paypalProcessingLog(env,{sessionId:payment.sessionId,eventId:ids.eventId,payloadHash});
  try{
    validatePayPalCapture(ids,payment);
    log.stage("PAYPAL_CAPTURE_VALIDATED");
    const session=await getSession(db,payment.sessionId);
    if(!session) throw new Error("SESSION_NOT_FOUND");
    const receipt=await getProofReceipt(db,payment.sessionId);
    if(payment.expectedRecipient){
      const saved=await getVerifiedPayPalWebhook(db,payloadHash);
      if(!saved?.payload)throw new Error('VERIFIED_PAYPAL_WEBHOOK_NOT_FOUND');
      await verifyProviderRecipient(env,payment,'SETTLEMENT',{payloadHash,webhook:saved.payload,captureId:ids.captureId});
    }else if(session.status!=='CAPTURED'||!receipt){
      throw new Error('LEGACY_RECIPIENT_RECONCILIATION_REQUIRED');
    }
    // Receipt existence alone is insufficient: its session attachment may have failed.
    if(session.status==="CAPTURED" && payment.status==="COMPLETED" &&
       receipt && session.proofReceiptId===receipt.receiptId){
      log.stage("PAYPAL_WEBHOOK_FINALIZED_DUPLICATE");
      return {duplicate:true,sessionId:payment.sessionId};
    }

    await addEvent(db,payment.sessionId,"PAYPAL_WEBHOOK_VERIFIED",{
      eventType:ids.eventType,eventId:ids.eventId,
      providerOrderId:payment.providerOrderId,providerCaptureId:ids.captureId
    });
    await appendSessionAuditEvent(db,payment.sessionId,"PAYPAL_WEBHOOK_VERIFIED",{
      eventType:ids.eventType,eventId:ids.eventId,payloadHash,
      providerOrderId:payment.providerOrderId,providerCaptureId:ids.captureId
    });
    log.stage("PAYPAL_WEBHOOK_EVENT_AUDITED");
    const finished=await finishVerifiedCapture(env,{
      provider:"paypal",sessionId:payment.sessionId,
      providerOrderId:payment.providerOrderId!,providerPaymentId:ids.captureId,
      amount:ids.amount,currency:ids.currency,verifiedPayPalPayloadHash:payloadHash
    },log.stage);
    return {
      processed:true,sessionId:payment.sessionId,walletSpend:finished.spend,
      proofReceipt:{receiptId:finished.receipt.receiptId,proofHash:finished.receipt.proofHash}
    };
  }catch(error){log.error(error);throw error;}
}

// Queue messages carry only the hash of evidence persisted AFTER signature verification.
// Reload payment identity on each attempt; never trust browser redirects or capture API results.
export async function finalizePayPalCaptureJob(env:SessionPaymentEnv,job:PayPalSettlementJob){
  const db=requireDb(env);
  const saved=await getVerifiedPayPalWebhook(db,job.payloadHash);
  if(!saved?.session_id) throw new Error("VERIFIED_PAYPAL_WEBHOOK_NOT_FOUND");
  const ids=extractPayPalWebhookIds(saved.payload);
  const payment=await getSessionPayment(db,String(saved.session_id));
  if(!payment) throw new Error("SESSION_PAYMENT_NOT_FOUND");
  return settleVerifiedPayPalCapture(env,job.payloadHash,ids,payment);
}

export async function processSessionPayPalWebhook(env:SessionPaymentEnv,request:Request){
  const db=requireDb(env);
  const rawBody=await request.text();
  console.log("PAYPAL_WEBHOOK_RECEIVED",{
    transmissionIdPresent:Boolean(request.headers.get("paypal-transmission-id")),
    transmissionTimePresent:Boolean(request.headers.get("paypal-transmission-time")),
    certUrlPresent:Boolean(request.headers.get("paypal-cert-url")),
    authAlgoPresent:Boolean(request.headers.get("paypal-auth-algo")),
    transmissionSigPresent:Boolean(request.headers.get("paypal-transmission-sig")),
    bodyLength:rawBody.length
  });
  const verified=await verifyPayPalWebhook(env,request,rawBody);
  console.log("PAYPAL_WEBHOOK_VERIFICATION",{
    valid:verified.valid,verificationStatus:verified.verificationStatus
  });
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json"}
  });
  if(!verified.valid) return json({
    error:"INVALID_PAYPAL_WEBHOOK_SIGNATURE",verificationStatus:verified.verificationStatus
  },401);

  const ids=extractPayPalWebhookIds(verified.event);
  console.log("PAYPAL_WEBHOOK_IDS",ids);
  let payment=ids.captureId?await getSessionPaymentByCaptureId(db,ids.captureId):null;
  if(!payment && ids.orderId) payment=await getSessionPaymentByProviderOrderId(db,ids.orderId);
  console.log("PAYPAL_WEBHOOK_PAYMENT_LOOKUP",{
    found:Boolean(payment),sessionId:payment?.sessionId??null,provider:payment?.provider??null,
    providerOrderId:payment?.providerOrderId??null,providerCaptureId:payment?.providerCaptureId??null
  });
  if(!payment || payment.provider!=="paypal"){
    // Signature verification authorizes preserving evidence, not assigning an
    // unknown event to a browser-selected wallet or session.
    await claimSessionWebhook(db,{payloadHash:await hashWebhook(rawBody),eventType:ids.eventType,provider:'paypal',providerLinkId:ids.orderId,providerPaymentId:ids.captureId,sessionId:null,payload:verified.event});
    return json({received:true,ignored:true,reason:"PAYPAL_SESSION_NOT_FOUND"});
  }

  const log=paypalProcessingLog(env,{sessionId:payment.sessionId,eventId:ids.eventId});
  try{
    log.stage("PAYPAL_WEBHOOK_HASH");
    const payloadHash=await hashWebhook(rawBody);
    log.stage("PAYPAL_WEBHOOK_CLAIM",{status:"started",payloadHash});
    const claimed=await claimSessionWebhook(db,{
      payloadHash,eventType:ids.eventType,provider:"paypal",
      providerLinkId:ids.orderId??payment.providerOrderId,
      providerPaymentId:ids.captureId,sessionId:payment.sessionId,payload:verified.event
    });
    log.stage("PAYPAL_WEBHOOK_CLAIM",{claimed,payloadHash});
    if(ids.eventType==='PAYMENT.CAPTURE.COMPLETED'||ids.eventType==='PAYMENT.CAPTURE.DENIED')validatePayPalCapture(ids,payment);

    if(ids.eventType==="PAYMENT.CAPTURE.COMPLETED"){
      // Claim means received, never settled. Retry incomplete settlement even when claimed=false.
      if(env.PURCHASE_QUEUE){
        log.stage("PAYPAL_WEBHOOK_ENQUEUE",{status:"started"});
        await env.PURCHASE_QUEUE.send({kind:"FINALIZE_PAYPAL_CAPTURE",payloadHash});
        log.stage("PAYPAL_WEBHOOK_ENQUEUE",{status:"completed"});
        return json({received:true,queued:true,sessionId:payment.sessionId},202);
      }
      // Local/test fallback retains the same replay-safe settlement path.
      return json({received:true,...await settleVerifiedPayPalCapture(env,payloadHash,ids,payment)});
    }
    if(ids.eventType==='PAYMENT.CAPTURE.DENIED'){
      if(payment.status!=='COMPLETED'){
        if(payment.expectedRecipient)await verifyProviderRecipient(env,payment,'CAPTURE',{captureId:ids.captureId,payloadHash,webhook:verified.event});
        await releaseVerifiedDeniedCapture(db,payment.sessionId,payloadHash);
      }
      await markSessionPaymentFailed(db,payment.sessionId,'DENIED',true);
    }
    if(!claimed) return json({received:true,duplicate:true,sessionId:payment.sessionId});
    await addEvent(db,payment.sessionId,"PAYPAL_WEBHOOK_VERIFIED",{
      eventType:ids.eventType,eventId:ids.eventId,
      providerOrderId:ids.orderId??payment.providerOrderId,providerCaptureId:ids.captureId
    });
    await appendSessionAuditEvent(db,payment.sessionId,"PAYPAL_WEBHOOK_VERIFIED",{
      eventType:ids.eventType,eventId:ids.eventId,payloadHash,
      providerOrderId:ids.orderId??payment.providerOrderId,providerCaptureId:ids.captureId
    });
    log.stage("PAYPAL_WEBHOOK_EVENT_AUDITED");
    return json({received:true,processed:true,eventType:ids.eventType,sessionId:payment.sessionId});
  }catch(error){log.error(error);throw error;}
}

function extractRazorpaySessionId(payload:any){
  return payload?.payload?.payment_link?.entity?.notes?.intentlock_session_id
    ?? payload?.payload?.payment?.entity?.notes?.intentlock_session_id
    ?? null;
}

export async function processSessionRazorpayWebhook(env:SessionPaymentEnv,request:Request):Promise<Response|null>{
  const db=requireDb(env);
  const rawBody=await request.text();
  const signature=request.headers.get("x-razorpay-signature");
  const valid=await verifyRazorpayWebhook(rawBody,signature,env.RAZORPAY_WEBHOOK_SECRET);
  if(!valid){
    return new Response(JSON.stringify({error:"INVALID_WEBHOOK_SIGNATURE"}),{
      status:401,headers:{"content-type":"application/json"}
    });
  }

  const payload:any=JSON.parse(rawBody);
  const eventType=String(payload.event??"unknown");
  const providerOrderId=payload?.payload?.payment_link?.entity?.id??null;
  const providerPaymentId=payload?.payload?.payment?.entity?.id??null;
  let sessionId=extractRazorpaySessionId(payload);

  if(!sessionId && providerOrderId){
    const p=await getSessionPaymentByProviderOrderId(db,String(providerOrderId));
    sessionId=p?.sessionId??null;
  }
  if(!sessionId) return null;

  const session=await getSession(db,String(sessionId));
  if(!session) return null;
  const payloadHash=await hashWebhook(rawBody);
  const claimed=await claimSessionWebhook(db,{
    payloadHash,eventType,provider:"razorpay",
    providerLinkId:providerOrderId?String(providerOrderId):null,
    providerPaymentId:providerPaymentId?String(providerPaymentId):null,
    sessionId:session.sessionId,payload
  });

  if(!claimed&&eventType!=='payment_link.paid'){
    return new Response(JSON.stringify({received:true,duplicate:true,sessionId:session.sessionId}),{
      status:200,headers:{"content-type":"application/json"}
    });
  }

  if(claimed){await addEvent(db,session.sessionId,"RAZORPAY_WEBHOOK_VERIFIED",{
    eventType,providerOrderId,providerPaymentId
  });
  await appendSessionAuditEvent(db,session.sessionId,"RAZORPAY_WEBHOOK_VERIFIED",{
    eventType,providerOrderId,providerPaymentId,payloadHash
  });}

  if(eventType!=="payment_link.paid"){
    return new Response(JSON.stringify({received:true,processed:true,eventType,sessionId:session.sessionId}),{
      status:200,headers:{"content-type":"application/json"}
    });
  }

  const payment=await getSessionPayment(db,session.sessionId);
  if(!payment||!payment.providerOrderId) throw new Error("SESSION_PAYMENT_NOT_FOUND");
  if(providerOrderId && String(providerOrderId)!==payment.providerOrderId)
    throw new Error("PROVIDER_ORDER_MISMATCH");

  const entity=payload?.payload?.payment_link?.entity??{};
  const amountPaidPaise=Number(entity.amount_paid??entity.amount??0);
  const amount=amountPaidPaise?amountPaidPaise/100:payment.amount;

  const finished=await finishVerifiedCapture(env,{
    provider:"razorpay",sessionId:session.sessionId,
    providerOrderId:payment.providerOrderId,
    providerPaymentId:providerPaymentId?String(providerPaymentId):null,
    amount,currency:payment.currency,verifiedWebhookPayloadHash:payloadHash
  });

  return new Response(JSON.stringify({
    received:true,processed:true,sessionId:session.sessionId,
    walletSpend:finished.spend,
    proofReceipt:{receiptId:finished.receipt.receiptId,proofHash:finished.receipt.proofHash}
  }),{status:200,headers:{"content-type":"application/json"}});
}
