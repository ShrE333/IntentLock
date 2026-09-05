import {canonicalWalletTransaction,sha256Hex} from "../wallets/crypto";
import {evaluateWalletTransaction} from "../wallets/policy";
import {getWallet} from "../wallets/repository";
import {getSession,addEvent} from "../sessions/repository";
import {verifyRazorpayWebhook} from "../payments/webhook";
import {sha256Hex as hashWebhook} from "../db/audit";
import {buildSessionPaymentIdempotencyKey} from "./crypto";
import {SessionPaymentLock} from "./lock";
import {createSessionRazorpayLink} from "./razorpay";
import {
  applyWalletSpendOnce,
  claimSessionWebhook,
  consumeOneTimeAuthorization,
  findWhatsappChatForSession,
  getSessionPaymentLink,
  getSessionPaymentLinkByProviderId,
  markSessionPaymentCaptured,
  markSessionPaymentCreationFailed,
  persistSessionPaymentLink,
  releaseOneTimeAuthorization,
  reserveSessionPayment,
  updateSessionPaymentPending
} from "./repository";
import {appendSessionAuditEvent,mirrorSessionTraceToAudit} from "./audit";
import {createProofReceipt} from "./proof";
import {sendWahaText} from "../whatsapp/waha-client";
import {getCommerceConnectors} from "../commerce/registry";

export type SessionPaymentEnv={
  DATABASE_URL?:string;
  APPROVAL_SIGNING_SECRET?:string;
  UPSTASH_REDIS_REST_URL?:string;
  UPSTASH_REDIS_REST_TOKEN?:string;
  RAZORPAY_KEY_ID?:string;
  RAZORPAY_KEY_SECRET?:string;
  RAZORPAY_WEBHOOK_SECRET?:string;

  COMMERCE_CATALOG_URL?:string;
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

export async function createPaymentLinkForSession(
  env:SessionPaymentEnv,
  sessionId:string
){
  const db=requireDb(env);

  const existing=await getSessionPaymentLink(db,sessionId);
  if(existing){
    return {duplicate:true,paymentLink:existing};
  }

  const session=await getSession(db,sessionId);
  if(!session) throw new Error("SESSION_NOT_FOUND");

  if(session.status==="CAPTURED"){
    const paid=await getSessionPaymentLink(db,sessionId);
    return {duplicate:true,paymentLink:paid};
  }

  if(session.status!=="READY_TO_PAY")
    throw new Error(`SESSION_NOT_READY_TO_PAY:${session.status}`);

  if(!session.selectedProduct)
    throw new Error("SELECTED_PRODUCT_NOT_FOUND");

  const wallet=await getWallet(db,session.walletId);
  if(!wallet) throw new Error("WALLET_NOT_FOUND");

  // V10.4/V10.5 events existed before the audit-chain integration.
  // Mirror the complete pre-payment session trace exactly once.
  await mirrorSessionTraceToAudit(db,sessionId);

  // Re-fetch Shopify immediately before payment.
  // Other existing connectors preserve their V10.6 behavior.
  let freshProduct=session.selectedProduct;

  if(session.connectorId==="shopify-storefront"){
    const connector=getCommerceConnectors(env)
      .find(c=>c.info().id===session.connectorId);

    if(!connector)
      throw new Error("SHOPIFY_CONNECTOR_NOT_AVAILABLE_AT_PAYMENT");

    const live=await connector.getProduct(session.selectedProduct.id);

    if(!live)
      throw new Error("COMMERCE_PRODUCT_NO_LONGER_AVAILABLE");

    if(live.quantityAvailable<=0)
      throw new Error("COMMERCE_PRODUCT_OUT_OF_STOCK");

    freshProduct=live;
  }

  const selectedTx={
    productName:session.selectedProduct.title,
    category:session.selectedProduct.category,
    brand:session.selectedProduct.brand,
    amount:session.selectedProduct.price,
    currency:session.selectedProduct.currency,
    quantity:1,
    features:session.selectedProduct.features
  };

  const freshTx={
    productName:freshProduct.title,
    category:freshProduct.category,
    brand:freshProduct.brand,
    amount:freshProduct.price,
    currency:freshProduct.currency,
    quantity:1,
    features:freshProduct.features
  };

  const selectedQuoteHash=await sha256Hex(
    canonicalWalletTransaction(selectedTx)
  );

  const freshQuoteHash=await sha256Hex(
    canonicalWalletTransaction(freshTx)
  );

  if(selectedQuoteHash!==freshQuoteHash){
    await addEvent(db,sessionId,"COMMERCE_QUOTE_CHANGED",{
      connectorId:session.connectorId,
      productId:session.selectedProduct.id,
      previous:{
        price:session.selectedProduct.price,
        currency:session.selectedProduct.currency,
        brand:session.selectedProduct.brand,
        category:session.selectedProduct.category,
        features:session.selectedProduct.features
      },
      current:{
        price:freshProduct.price,
        currency:freshProduct.currency,
        brand:freshProduct.brand,
        category:freshProduct.category,
        features:freshProduct.features
      },
      previousQuoteHash:selectedQuoteHash,
      currentQuoteHash:freshQuoteHash
    });

    await appendSessionAuditEvent(db,sessionId,"COMMERCE_QUOTE_CHANGED",{
      connectorId:session.connectorId,
      productId:session.selectedProduct.id,
      previousQuoteHash:selectedQuoteHash,
      currentQuoteHash:freshQuoteHash
    });

    throw new Error("COMMERCE_QUOTE_CHANGED_REAUTHORIZE");
  }

  if(session.connectorId==="shopify-storefront"){
    await addEvent(db,sessionId,"COMMERCE_QUOTE_REVALIDATED",{
      connectorId:session.connectorId,
      productId:freshProduct.id,
      price:freshProduct.price,
      currency:freshProduct.currency,
      quoteHash:freshQuoteHash
    });

    await appendSessionAuditEvent(db,sessionId,"COMMERCE_QUOTE_REVALIDATED",{
      connectorId:session.connectorId,
      productId:freshProduct.id,
      price:freshProduct.price,
      currency:freshProduct.currency,
      quoteHash:freshQuoteHash
    });
  }

  const tx=freshTx;

  const evaluation=evaluateWalletTransaction(wallet,tx);

  if(evaluation.decision==="BLOCK"){
    await addEvent(db,sessionId,"PAYMENT_AUTHORITY_RECHECK_BLOCKED",{
      violations:evaluation.violations
    });
    await appendSessionAuditEvent(db,sessionId,"PAYMENT_AUTHORITY_RECHECK_BLOCKED",{
      violations:evaluation.violations
    });
    throw new Error(`AUTHORITY_CHANGED:${evaluation.violations.join(",")}`);
  }

  const quoteHash=await sha256Hex(canonicalWalletTransaction(tx));
  const amount=freshProduct.price;
  const currency=freshProduct.currency;

  if(currency!=="INR") throw new Error("UNSUPPORTED_PAYMENT_CURRENCY");

  const idempotencyKey=await buildSessionPaymentIdempotencyKey({
    sessionId,
    walletId:wallet.walletId,
    quoteHash,
    amount,
    currency
  });

  const lock=SessionPaymentLock.fromEnv(env);

  const acquired=await lock.claim(
    idempotencyKey,
    JSON.stringify({
      sessionId,
      walletId:wallet.walletId,
      quoteHash,
      claimedAt:new Date().toISOString()
    }),
    900
  );

  if(!acquired){
    const afterClaim=await getSessionPaymentLink(db,sessionId);
    if(afterClaim) return {duplicate:true,paymentLink:afterClaim};
    throw new Error("SESSION_PAYMENT_ALREADY_IN_PROGRESS");
  }

  const reservation=await reserveSessionPayment(db,{
    sessionId,
    walletId:wallet.walletId,
    authorizationId:session.authorizationId,
    quoteHash,
    idempotencyKey,
    amount,
    currency:"INR"
  });

  if(reservation.provider_link_id){
    const already=await getSessionPaymentLink(db,sessionId);
    if(already) return {duplicate:true,paymentLink:already};
  }

  let consumedAuthorizationId:string|null=null;

  try{
    // If the transaction STILL needs step-up at execution time,
    // require and consume the exact one-time authorization.
    if(evaluation.decision==="STEP_UP"){
      if(!session.authorizationId)
        throw new Error("ONE_TIME_AUTHORIZATION_REQUIRED");

      const consumed=await consumeOneTimeAuthorization(db,{
        authorizationId:session.authorizationId,
        walletId:wallet.walletId,
        sessionId,
        quoteHash,
        amount
      });

      if(!consumed.consumed)
        throw new Error(consumed.reason);

      consumedAuthorizationId=session.authorizationId;

      await addEvent(db,sessionId,"ONE_TIME_AUTHORIZATION_CONSUMED",{
        authorizationId:session.authorizationId,
        quoteHash,
        amount,
        reason:consumed.reason
      });

      await appendSessionAuditEvent(db,sessionId,"ONE_TIME_AUTHORIZATION_CONSUMED",{
        authorizationId:session.authorizationId,
        quoteHash,
        amount,
        tokenHash:consumed.token_hash
      });
    } else {
      await addEvent(db,sessionId,"PAYMENT_AUTHORITY_RECHECK_ALLOWED",{
        decision:evaluation.decision,
        quoteHash,
        amount
      });

      await appendSessionAuditEvent(db,sessionId,"PAYMENT_AUTHORITY_RECHECK_ALLOWED",{
        decision:evaluation.decision,
        quoteHash,
        amount
      });
    }

    const walletExpiry=new Date(wallet.validUntil).getTime();
    const maxExpiry=Date.now()+20*60*1000;
    const expiryMs=Math.min(walletExpiry,maxExpiry);

    if(expiryMs-Date.now()<15*60*1000)
      throw new Error("WALLET_EXPIRES_TOO_SOON_FOR_PAYMENT_LINK");

    const provider=await createSessionRazorpayLink(env,{
      sessionId,
      walletId:wallet.walletId,
      authorizationId:session.authorizationId,
      quoteHash,
      productId:freshProduct.id,
      productTitle:freshProduct.title,
      amount,
      currency:"INR",
      idempotencyKey,
      expireBy:Math.floor(expiryMs/1000)
    });

    const persisted=await persistSessionPaymentLink(db,{
      sessionId,
      walletId:wallet.walletId,
      authorizationId:session.authorizationId,
      quoteHash,
      idempotencyKey,
      providerLinkId:provider.id,
      referenceId:provider.reference_id,
      shortUrl:provider.short_url,
      amount,
      currency:"INR",
      status:provider.status,
      expiresAt:provider.expire_by
        ? new Date(provider.expire_by*1000).toISOString()
        : new Date(expiryMs).toISOString()
    });

    await updateSessionPaymentPending(db,{
      sessionId,
      quoteHash,
      idempotencyKey,
      providerLinkId:provider.id,
      shortUrl:provider.short_url
    });

    await addEvent(db,sessionId,"PAYMENT_LINK_CREATED",{
      provider:"razorpay",
      providerLinkId:provider.id,
      amount,
      currency:"INR",
      quoteHash,
      idempotencyKey
    });

    await appendSessionAuditEvent(db,sessionId,"PAYMENT_LINK_CREATED",{
      provider:"razorpay",
      providerLinkId:provider.id,
      amount,
      currency:"INR",
      quoteHash,
      idempotencyKey,
      authorizationId:session.authorizationId
    });

    return {duplicate:false,paymentLink:persisted};
  }catch(error){
    await markSessionPaymentCreationFailed(
      db,
      sessionId,
      error instanceof Error?error.message:String(error)
    );

    if(consumedAuthorizationId){
      await releaseOneTimeAuthorization(
        db,
        consumedAuthorizationId,
        sessionId
      );
    }

    await lock.release(idempotencyKey);
    throw error;
  }
}

function extractSessionId(payload:any){
  return payload?.payload?.payment_link?.entity?.notes?.intentlock_session_id
    ?? payload?.payload?.payment?.entity?.notes?.intentlock_session_id
    ?? null;
}

export async function processSessionRazorpayWebhook(
  env:SessionPaymentEnv,
  request:Request
):Promise<Response|null>{
  const db=requireDb(env);
  const rawBody=await request.text();

  const signature=request.headers.get("x-razorpay-signature");
  const valid=await verifyRazorpayWebhook(
    rawBody,
    signature,
    env.RAZORPAY_WEBHOOK_SECRET
  );

  if(!valid){
    return new Response(JSON.stringify({error:"INVALID_WEBHOOK_SIGNATURE"}),{
      status:401,
      headers:{"content-type":"application/json"}
    });
  }

  const payload:any=JSON.parse(rawBody);
  const eventType=String(payload.event??"unknown");

  const providerLinkId=
    payload?.payload?.payment_link?.entity?.id??null;

  const providerPaymentId=
    payload?.payload?.payment?.entity?.id??null;

  let sessionId=extractSessionId(payload);

  if(!sessionId && providerLinkId){
    const link=await getSessionPaymentLinkByProviderId(db,String(providerLinkId));
    sessionId=link?.sessionId??null;
  }

  // Not a PurchaseSession payment: let the legacy V7 webhook handle it.
  if(!sessionId) return null;

  const session=await getSession(db,String(sessionId));
  if(!session) return null;

  const payloadHash=await hashWebhook(rawBody);

  const claimed=await claimSessionWebhook(db,{
    payloadHash,
    eventType,
    providerLinkId:providerLinkId?String(providerLinkId):null,
    providerPaymentId:providerPaymentId?String(providerPaymentId):null,
    sessionId:session.sessionId,
    payload
  });

  if(!claimed){
    return new Response(JSON.stringify({
      received:true,
      duplicate:true,
      sessionId:session.sessionId
    }),{
      status:200,
      headers:{"content-type":"application/json"}
    });
  }

  await addEvent(db,session.sessionId,"RAZORPAY_WEBHOOK_VERIFIED",{
    eventType,
    providerLinkId,
    providerPaymentId
  });

  await appendSessionAuditEvent(db,session.sessionId,"RAZORPAY_WEBHOOK_VERIFIED",{
    eventType,
    providerLinkId,
    providerPaymentId,
    payloadHash
  });

  if(eventType!=="payment_link.paid"){
    return new Response(JSON.stringify({
      received:true,
      processed:true,
      eventType,
      sessionId:session.sessionId
    }),{
      status:200,
      headers:{"content-type":"application/json"}
    });
  }

  const payment=await getSessionPaymentLink(db,session.sessionId);
  if(!payment) throw new Error("SESSION_PAYMENT_LINK_NOT_FOUND");

  if(providerLinkId && String(providerLinkId)!==payment.providerLinkId)
    throw new Error("PROVIDER_LINK_MISMATCH");

  const entity=payload?.payload?.payment_link?.entity??{};
  const amountPaidPaise=Number(entity.amount_paid??entity.amount??0);
  const expectedPaise=Math.round(payment.amount*100);

  if(amountPaidPaise && amountPaidPaise!==expectedPaise)
    throw new Error(
      `PAYMENT_AMOUNT_MISMATCH:${amountPaidPaise}:${expectedPaise}`
    );

  const spend=await applyWalletSpendOnce(db,{
    sessionId:session.sessionId,
    walletId:session.walletId,
    amount:payment.amount,
    currency:"INR",
    providerLinkId:payment.providerLinkId,
    providerPaymentId:providerPaymentId?String(providerPaymentId):null
  });

  await addEvent(db,session.sessionId,"PAYMENT_CAPTURED",{
    provider:"razorpay",
    providerLinkId:payment.providerLinkId,
    providerPaymentId,
    amount:payment.amount,
    walletSpendApplied:spend.applied
  });

  await appendSessionAuditEvent(db,session.sessionId,"PAYMENT_CAPTURED",{
    provider:"razorpay",
    providerLinkId:payment.providerLinkId,
    providerPaymentId,
    amount:payment.amount
  });

  await addEvent(db,session.sessionId,"WALLET_SPEND_APPLIED",{
    ledgerId:spend.ledgerId,
    amount:payment.amount,
    spentAmount:spend.spentAmount,
    remainingAuthority:spend.remainingAuthority,
    replaySafe:true
  });

  await appendSessionAuditEvent(db,session.sessionId,"WALLET_SPEND_APPLIED",{
    ledgerId:spend.ledgerId,
    amount:payment.amount,
    spentAmount:spend.spentAmount,
    remainingAuthority:spend.remainingAuthority,
    replaySafe:true
  });

  await markSessionPaymentCaptured(db,{
    sessionId:session.sessionId,
    providerLinkId:payment.providerLinkId,
    providerPaymentId:providerPaymentId?String(providerPaymentId):null,
    amount:payment.amount,
    currency:"INR"
  });

  if(!env.APPROVAL_SIGNING_SECRET)
    throw new Error("APPROVAL_SIGNING_SECRET_NOT_CONFIGURED");

  const receipt=await createProofReceipt(
    db,
    env.APPROVAL_SIGNING_SECRET,
    session.sessionId
  );

  await addEvent(db,session.sessionId,"PROOF_RECEIPT_CREATED",{
    receiptId:receipt.receiptId,
    proofHash:receipt.proofHash
  });

  // WhatsApp confirmation uses the same session, not a separate backend.
  if(env.WAHA_BASE_URL&&env.WAHA_API_KEY){
    const chat=await findWhatsappChatForSession(db,session.sessionId);

    if(chat){
      try{
        await sendWahaText({
          baseUrl:env.WAHA_BASE_URL,
          apiKey:env.WAHA_API_KEY,
          session:chat.wahaSession,
          chatId:chat.chatId,
          text:
`✅ *Payment captured*

IntentLock verified the Razorpay webhook and updated your Intent Wallet.

Amount: ₹${payment.amount.toLocaleString("en-IN")}
Remaining authority: ₹${spend.remainingAuthority.toLocaleString("en-IN")}

🧾 Proof Receipt
${receipt.receiptId}

Proof hash:
${receipt.proofHash.slice(0,24)}…

Session:
${session.sessionId}`
        });
      }catch(error){
        console.error("WAHA payment confirmation failed",error);
      }
    }
  }

  return new Response(JSON.stringify({
    received:true,
    processed:true,
    sessionId:session.sessionId,
    walletSpend:spend,
    proofReceipt:{
      receiptId:receipt.receiptId,
      proofHash:receipt.proofHash
    }
  }),{
    status:200,
    headers:{"content-type":"application/json"}
  });
}
