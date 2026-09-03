import {getWallet} from "../wallets/repository";
import {evaluateWalletTransaction} from "../wallets/policy";
import {issueStepUpRequest,resolveStepUpRequest} from "../wallets/stepup";
import {getCommerceConnectors} from "../commerce/registry";
import type {CommerceProduct} from "../commerce/types";
import {
  addEvent,getEvents,getSession,updateSession
} from "./repository";

type Env={
  DATABASE_URL:string;
  APPROVAL_SIGNING_SECRET?:string;
  COMMERCE_CATALOG_URL?:string;
};

export async function runPurchaseSession(env:Env,sessionId:string){
  const session=await getSession(env.DATABASE_URL,sessionId);
  if(!session) throw new Error("SESSION_NOT_FOUND");

  const wallet=await getWallet(env.DATABASE_URL,session.walletId);
  if(!wallet) throw new Error("WALLET_NOT_FOUND");

  const connector=getCommerceConnectors(env)
    .find(c=>c.info().id===session.connectorId);

  if(!connector) throw new Error("CONNECTOR_NOT_AVAILABLE");

  await updateSession(env.DATABASE_URL,sessionId,{status:"SEARCHING"});
  await addEvent(env.DATABASE_URL,sessionId,"SEARCH_STARTED",{
    connector:connector.info().name,
    query:session.userPrompt
  });

  const products=await connector.search({
    query:session.userPrompt,
    category:wallet.allowedCategories[0],
    brands:wallet.allowedBrands,
    maxPrice:wallet.maxSingleTransaction,
    requiredFeatures:wallet.requiredFeatures,
    limit:12
  });

  const evaluated:{
    product:CommerceProduct;
    decision:"ALLOW"|"STEP_UP"|"BLOCK";
    violations:string[];
    reasons:string[];
    additionalAuthorityRequired:number;
  }[]=[];

  for(const product of products){
    await addEvent(env.DATABASE_URL,sessionId,"PRODUCT_FOUND",{
      productId:product.id,
      title:product.title,
      merchant:product.merchant,
      price:product.price,
      brand:product.brand
    });

    if(product.merchantMessage){
      await addEvent(env.DATABASE_URL,sessionId,"MERCHANT_TEXT_OBSERVED",{
        productId:product.id,
        merchant:product.merchant,
        trust:"UNTRUSTED",
        message:product.merchantMessage
      });
    }

    const evaluation=evaluateWalletTransaction(wallet,{
      productName:product.title,
      category:product.category,
      brand:product.brand,
      amount:product.price,
      currency:product.currency,
      quantity:1,
      features:product.features
    });

    evaluated.push({
      product,
      decision:evaluation.decision,
      violations:evaluation.violations,
      reasons:evaluation.reasons,
      additionalAuthorityRequired:evaluation.additionalAuthorityRequired
    });

    await addEvent(env.DATABASE_URL,sessionId,"POLICY_DECISION",{
      productId:product.id,
      title:product.title,
      decision:evaluation.decision,
      violations:evaluation.violations,
      additionalAuthorityRequired:evaluation.additionalAuthorityRequired
    });
  }

  const allowed=evaluated.filter(x=>x.decision==="ALLOW");
  const stepUps=evaluated.filter(x=>x.decision==="STEP_UP");

  // Selection is deterministic: lowest-priced valid autonomous candidate first.
  if(allowed.length){
    allowed.sort((a,b)=>a.product.price-b.product.price);
    const selected=allowed[0];

    await updateSession(env.DATABASE_URL,sessionId,{
      status:"READY_TO_PAY",
      selectedProduct:selected.product,
      selectedDecision:"ALLOW"
    });

    await addEvent(env.DATABASE_URL,sessionId,"CANDIDATE_SELECTED",{
      productId:selected.product.id,
      title:selected.product.title,
      price:selected.product.price,
      reason:"LOWEST_PRICE_AUTONOMOUSLY_ALLOWED"
    });

    await addEvent(env.DATABASE_URL,sessionId,"AUTO_AUTHORIZED",{
      productId:selected.product.id,
      amount:selected.product.price,
      note:"Eligible for payment execution; Razorpay session wiring is completed in the payment/receipt milestone."
    });
  } else if(stepUps.length){
    stepUps.sort((a,b)=>a.product.price-b.product.price);
    const selected=stepUps[0];

    const evaluation=evaluateWalletTransaction(wallet,{
      productName:selected.product.title,
      category:selected.product.category,
      brand:selected.product.brand,
      amount:selected.product.price,
      currency:selected.product.currency,
      quantity:1,
      features:selected.product.features
    });

    const stepUp=await issueStepUpRequest(
      env.DATABASE_URL,wallet,{
        productName:selected.product.title,
        category:selected.product.category,
        brand:selected.product.brand,
        amount:selected.product.price,
        currency:selected.product.currency,
        quantity:1,
        features:selected.product.features
      },evaluation
    );

    await updateSession(env.DATABASE_URL,sessionId,{
      status:"AWAITING_STEP_UP",
      selectedProduct:selected.product,
      selectedDecision:"STEP_UP",
      stepUpRequestId:stepUp?.requestId??null
    });

    await addEvent(env.DATABASE_URL,sessionId,"CANDIDATE_SELECTED",{
      productId:selected.product.id,
      title:selected.product.title,
      price:selected.product.price,
      reason:"BEST_VALID_CANDIDATE_REQUIRES_STEP_UP"
    });

    await addEvent(env.DATABASE_URL,sessionId,"STEP_UP_REQUIRED",{
      requestId:stepUp?.requestId??null,
      requestedAmount:selected.product.price,
      additionalAuthorityRequired:selected.additionalAuthorityRequired
    });
  } else {
    await updateSession(env.DATABASE_URL,sessionId,{
      status:"BLOCKED",
      selectedDecision:"BLOCK"
    });

    await addEvent(env.DATABASE_URL,sessionId,"SESSION_BLOCKED",{
      reason:"NO_AUTHORIZED_CANDIDATE",
      evaluatedCandidates:evaluated.length
    });
  }

  return {
    session:await getSession(env.DATABASE_URL,sessionId),
    events:await getEvents(env.DATABASE_URL,sessionId),
    candidates:evaluated
  };
}

export async function resolveSessionStepUp(
  env:Env,
  sessionId:string,
  action:"ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT"
){
  const session=await getSession(env.DATABASE_URL,sessionId);
  if(!session) throw new Error("SESSION_NOT_FOUND");
  if(!session.stepUpRequestId) throw new Error("SESSION_HAS_NO_STEP_UP_REQUEST");
  if(!env.APPROVAL_SIGNING_SECRET) throw new Error("APPROVAL_SIGNING_SECRET_NOT_CONFIGURED");

  const wallet=await getWallet(env.DATABASE_URL,session.walletId);
  if(!wallet) throw new Error("WALLET_NOT_FOUND");

  const result=await resolveStepUpRequest(
    env.DATABASE_URL,
    env.APPROVAL_SIGNING_SECRET,
    wallet,
    session.stepUpRequestId,
    action
  );

  if(action==="REJECT"){
    await updateSession(env.DATABASE_URL,sessionId,{status:"REJECTED"});
    await addEvent(env.DATABASE_URL,sessionId,"STEP_UP_REJECTED",{
      requestId:session.stepUpRequestId
    });
  } else {
    await updateSession(env.DATABASE_URL,sessionId,{
      status:"READY_TO_PAY",
      authorizationId:result.authorizationId??null
    });

    await addEvent(env.DATABASE_URL,sessionId,
      action==="ALLOW_ONCE"?"STEP_UP_APPROVED_ONCE":"AUTO_LIMIT_RAISED",
      {
        requestId:session.stepUpRequestId,
        authorizationId:result.authorizationId??null,
        newAutoBuyLimit:result.newAutoBuyLimit??null,
        paymentAllowed:result.paymentAllowed
      }
    );
  }

  return {
    result,
    session:await getSession(env.DATABASE_URL,sessionId),
    events:await getEvents(env.DATABASE_URL,sessionId)
  };
}
