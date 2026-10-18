import {getWallet} from "../wallets/repository";
import {evaluateWalletTransaction} from "../wallets/policy";
import {issueStepUpRequest,resolveStepUpRequest} from "../wallets/stepup";
import {getCommerceConnectors} from "../commerce/registry";
import type {CommerceProduct} from "../commerce/types";
import {authorizeProductContext,type AuthorizationContextEnv} from "../payments/authorization-context";
import {addEvent,addEvents,getEvents,getSession,updateSession} from "./repository";

type Env=AuthorizationContextEnv & {
  DATABASE_URL:string;
  APPROVAL_SIGNING_SECRET?:string;
  COMMERCE_CATALOG_URL?:string;
  SHOPIFY_STORE_DOMAIN?:string;
  SHOPIFY_STOREFRONT_PUBLIC_TOKEN?:string;
  SHOPIFY_STOREFRONT_PRIVATE_TOKEN?:string;
  SHOPIFY_STOREFRONT_API_VERSION?:string;
};

type EvaluatedCandidate={
  product:CommerceProduct;
  decision:"ALLOW"|"STEP_UP"|"BLOCK";
  violations:string[];
  reasons:string[];
  additionalAuthorityRequired:number;
  walletAmount:number;
  walletCurrency:string;
};

export async function runPurchaseSession(env:Env,sessionId:string){
  const session=await getSession(env.DATABASE_URL,sessionId);
  if(!session) throw new Error("SESSION_NOT_FOUND");
  const wallet=await getWallet(env.DATABASE_URL,session.walletId);
  if(!wallet) throw new Error("WALLET_NOT_FOUND");
  const connector=getCommerceConnectors(env).find(c=>c.info().id===session.connectorId);
  if(!connector) throw new Error("CONNECTOR_NOT_AVAILABLE");

  await updateSession(env.DATABASE_URL,sessionId,{status:"SEARCHING"});
  await addEvent(env.DATABASE_URL,sessionId,"SEARCH_STARTED",{
    connector:connector.info().name,query:session.userPrompt,
    walletCurrency:wallet.currency,buyerCountry:wallet.countryCode
  });

  // Do not push the wallet's numeric ceiling into a marketplace that may quote
  // a different currency. IntentLock converts each candidate before policy evaluation.
  const products=await connector.search({
    query:session.userPrompt,category:wallet.allowedCategories[0],brands:wallet.allowedBrands,
    requiredFeatures:wallet.requiredFeatures,limit:12
  });

  const evaluated:EvaluatedCandidate[]=[];
  const trace:{type:string;payload:Record<string,unknown>}[]=[];

  for(const rawProduct of products){
    let authorized;
    try{
      authorized=await authorizeProductContext(env,wallet,rawProduct);
    }catch(error){
      const reason=error instanceof Error?error.message:String(error);
      const product={...rawProduct};
      evaluated.push({
        product,decision:"BLOCK",violations:[reason],reasons:["Currency normalization failed."],
        additionalAuthorityRequired:0,walletAmount:0,walletCurrency:wallet.currency
      });
      trace.push({type:"PRODUCT_FOUND",payload:{
        productId:product.id,title:product.title,merchant:product.merchant,
        merchantCountry:product.merchantCountry??"UNKNOWN",price:product.price,currency:product.currency,brand:product.brand
      }});
      trace.push({type:"FX_NORMALIZATION_BLOCKED",payload:{productId:product.id,reason}});
      continue;
    }

    const product=authorized.product;
    const tx=authorized.transaction;
    trace.push({type:"PRODUCT_FOUND",payload:{
      productId:product.id,title:product.title,merchant:product.merchant,
      merchantCountry:authorized.context.merchantCountry,price:product.price,currency:product.currency,brand:product.brand
    }});

    if(product.merchantMessage){
      trace.push({type:"MERCHANT_TEXT_OBSERVED",payload:{
        productId:product.id,merchant:product.merchant,trust:"UNTRUSTED",message:product.merchantMessage
      }});
    }

    if(authorized.context.fxQuote){
      trace.push({type:"FX_QUOTE_BOUND",payload:{
        productId:product.id,fxQuoteId:authorized.context.fxQuote.quoteId,
        fxSource:authorized.context.fxQuote.source,
        presentmentAmount:authorized.context.presentmentAmount,
        presentmentCurrency:authorized.context.presentmentCurrency,
        walletAmount:authorized.context.walletAmount,walletCurrency:authorized.context.walletCurrency,
        fxRate:authorized.context.fxQuote.rate,expiresAt:authorized.context.fxQuote.expiresAt
      }});
    }

    const evaluation=evaluateWalletTransaction(wallet,tx);
    evaluated.push({
      product,decision:evaluation.decision,violations:evaluation.violations,reasons:evaluation.reasons,
      additionalAuthorityRequired:evaluation.additionalAuthorityRequired,
      walletAmount:tx.amount,walletCurrency:tx.currency
    });
    trace.push({type:"POLICY_DECISION",payload:{
      productId:product.id,title:product.title,decision:evaluation.decision,
      violations:evaluation.violations,additionalAuthorityRequired:evaluation.additionalAuthorityRequired,
      presentmentAmount:product.price,presentmentCurrency:product.currency,
      walletAmount:tx.amount,walletCurrency:tx.currency,
      buyerCountry:authorized.context.buyerCountry,merchantCountry:authorized.context.merchantCountry
    }});
  }

  const allowed=evaluated.filter(x=>x.decision==="ALLOW").sort((a,b)=>a.walletAmount-b.walletAmount);
  const stepUps=evaluated.filter(x=>x.decision==="STEP_UP").sort((a,b)=>a.walletAmount-b.walletAmount);

  if(allowed.length){
    const selected=allowed[0];
    await updateSession(env.DATABASE_URL,sessionId,{
      status:"READY_TO_PAY",selectedProduct:selected.product,selectedDecision:"ALLOW"
    });
    trace.push({type:"CANDIDATE_SELECTED",payload:{
      productId:selected.product.id,title:selected.product.title,
      presentmentAmount:selected.product.price,presentmentCurrency:selected.product.currency,
      walletAmount:selected.walletAmount,walletCurrency:selected.walletCurrency,
      reason:"LOWEST_WALLET_COST_AUTONOMOUSLY_ALLOWED"
    }});
    trace.push({type:"AUTO_AUTHORIZED",payload:{
      productId:selected.product.id,walletAmount:selected.walletAmount,walletCurrency:selected.walletCurrency,
      note:"Candidate is inside delegated authority after currency normalization."
    }});
  }else if(stepUps.length){
    const selected=stepUps[0];
    if(!selected.product.authorizationContext) throw new Error("AUTHORIZATION_CONTEXT_MISSING");
    const tx={
      productName:selected.product.title,category:selected.product.category,brand:selected.product.brand,
      amount:selected.product.authorizationContext.walletAmount,
      currency:selected.product.authorizationContext.walletCurrency,quantity:1,features:selected.product.features,
      presentmentAmount:selected.product.authorizationContext.presentmentAmount,
      presentmentCurrency:selected.product.authorizationContext.presentmentCurrency,
      buyerCountry:selected.product.authorizationContext.buyerCountry,
      merchantCountry:selected.product.authorizationContext.merchantCountry,
      fxQuoteId:selected.product.authorizationContext.fxQuote?.quoteId,
      fxRate:selected.product.authorizationContext.fxQuote?.rate,
      fxSource:selected.product.authorizationContext.fxQuote?.source,
      fxQuotedAt:selected.product.authorizationContext.fxQuote?.quotedAt,
      fxExpiresAt:selected.product.authorizationContext.fxQuote?.expiresAt
    };
    const evaluation=evaluateWalletTransaction(wallet,tx);
    const stepUp=await issueStepUpRequest(env.DATABASE_URL,wallet,tx,evaluation);
    await updateSession(env.DATABASE_URL,sessionId,{
      status:"AWAITING_STEP_UP",selectedProduct:selected.product,selectedDecision:"STEP_UP",
      stepUpRequestId:stepUp?.requestId??null
    });
    trace.push({type:"CANDIDATE_SELECTED",payload:{
      productId:selected.product.id,title:selected.product.title,
      presentmentAmount:selected.product.price,presentmentCurrency:selected.product.currency,
      walletAmount:selected.walletAmount,walletCurrency:selected.walletCurrency,
      reason:"BEST_VALID_CANDIDATE_REQUIRES_STEP_UP"
    }});
    trace.push({type:"STEP_UP_REQUIRED",payload:{
      requestId:stepUp?.requestId??null,requestedAmount:selected.walletAmount,
      currency:selected.walletCurrency,additionalAuthorityRequired:selected.additionalAuthorityRequired
    }});
  }else{
    await updateSession(env.DATABASE_URL,sessionId,{status:"BLOCKED",selectedDecision:"BLOCK"});
    trace.push({type:"SESSION_BLOCKED",payload:{reason:"NO_AUTHORIZED_CANDIDATE",evaluatedCandidates:evaluated.length}});
  }

  await addEvents(env.DATABASE_URL,sessionId,trace);
  return {session:await getSession(env.DATABASE_URL,sessionId),events:await getEvents(env.DATABASE_URL,sessionId),candidates:evaluated};
}

export async function resolveSessionStepUp(env:Env,sessionId:string,action:"ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT"){
  const session=await getSession(env.DATABASE_URL,sessionId);
  if(!session) throw new Error("SESSION_NOT_FOUND");
  if(!session.stepUpRequestId) throw new Error("SESSION_HAS_NO_STEP_UP_REQUEST");
  if(!env.APPROVAL_SIGNING_SECRET) throw new Error("APPROVAL_SIGNING_SECRET_NOT_CONFIGURED");
  const wallet=await getWallet(env.DATABASE_URL,session.walletId);
  if(!wallet) throw new Error("WALLET_NOT_FOUND");
  const result=await resolveStepUpRequest(env.DATABASE_URL,env.APPROVAL_SIGNING_SECRET,wallet,session.stepUpRequestId,action);

  if(action==="REJECT"){
    await updateSession(env.DATABASE_URL,sessionId,{status:"REJECTED"});
    await addEvent(env.DATABASE_URL,sessionId,"STEP_UP_REJECTED",{requestId:session.stepUpRequestId});
  }else{
    await updateSession(env.DATABASE_URL,sessionId,{status:"READY_TO_PAY",authorizationId:result.authorizationId??null});
    await addEvent(env.DATABASE_URL,sessionId,action==="ALLOW_ONCE"?"STEP_UP_APPROVED_ONCE":"AUTO_LIMIT_RAISED",{
      requestId:session.stepUpRequestId,authorizationId:result.authorizationId??null,
      newAutoBuyLimit:result.newAutoBuyLimit??null,paymentAllowed:result.paymentAllowed
    });
  }

  return {result,session:await getSession(env.DATABASE_URL,sessionId),events:await getEvents(env.DATABASE_URL,sessionId)};
}
