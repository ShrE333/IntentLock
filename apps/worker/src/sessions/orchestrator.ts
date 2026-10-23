import {getWallet} from "../wallets/repository";
import {evaluateWalletTransaction} from "../wallets/policy";
import {issueStepUpRequest,resolveStepUpRequest} from "../wallets/stepup";
import {getCommerceConnectors,type CommerceEnv} from "../commerce/registry";
import type {CommerceProduct} from "../commerce/types";
import {authorizeProductContext,type AuthorizationContextEnv} from "../payments/authorization-context";
import {planCommerceSearchQuery} from "../commerce/query-planner";
import {assessAndTighten} from '../risk/tighten';
import {transactionFromAuthorizationContext} from '../payments/authorization-context';
import {addEvent,addEvents,getEvents,getSession,updateSession,claimSessionRun} from "./repository";

type Env=AuthorizationContextEnv & CommerceEnv & {
  DATABASE_URL:string;
  APPROVAL_SIGNING_SECRET?:string;
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
  if(session.connectorId==='shopify-global-catalog')throw new Error('COMMERCE_DISCOVERY_ONLY');
  if(session.status!=='CREATED') throw new Error(`SESSION_NOT_RUNNABLE:${session.status}`);
  const wallet=await getWallet(env.DATABASE_URL,session.walletId);
  if(!wallet) throw new Error("WALLET_NOT_FOUND");
  const connector=getCommerceConnectors(env).find(c=>c.info().id===session.connectorId);
  if(!connector) throw new Error("CONNECTOR_NOT_AVAILABLE");

  if(!await claimSessionRun(env.DATABASE_URL,sessionId)) throw new Error('SESSION_RUN_ALREADY_CLAIMED');
  await addEvent(env.DATABASE_URL,sessionId,"SEARCH_STARTED",{
    connector:connector.info().name,query:session.userPrompt,
    walletCurrency:wallet.currency,buyerCountry:wallet.countryCode
  });

  const discoveryQuery=planCommerceSearchQuery(session.userPrompt);
  await addEvent(env.DATABASE_URL,sessionId,"DISCOVERY_QUERY_PLANNED",{
    originalPrompt:session.userPrompt,searchQuery:discoveryQuery,
    note:"Commerce discovery uses the user's product intent only. Wallet policy is evaluated afterwards and cannot silently rewrite search results."
  });

  // Discovery and authorization are deliberately separated. Do not inject allowed
  // brands/categories/features into marketplace search: doing so hides blocked
  // candidates and makes the policy engine look hard-coded.
  const products=await connector.search({query:discoveryQuery,limit:12});

  if(!products.length){
    await updateSession(env.DATABASE_URL,sessionId,{status:"BLOCKED",selectedDecision:"BLOCK"});
    await addEvent(env.DATABASE_URL,sessionId,"COMMERCE_NO_RESULTS",{
      connector:connector.info().name,searchQuery:discoveryQuery,
      reason:"Marketplace returned no candidates; this is not a wallet-policy rejection."
    });
    return {session:await getSession(env.DATABASE_URL,sessionId),events:await getEvents(env.DATABASE_URL,sessionId),candidates:[]};
  }

  const evaluated:EvaluatedCandidate[]=[];
  const trace:{type:string;payload:Record<string,unknown>}[]=[];

  for(const rawProduct of products){
    let authorized;
    try{
      authorized=await authorizeProductContext(env,wallet,rawProduct,connector.info().id);
    }catch(error){
      const reason=error instanceof Error?error.message:String(error);
      const product={...rawProduct};
      evaluated.push({
        product,decision:"BLOCK",violations:[reason],reasons:["Authorization context could not be safely bound."],
        additionalAuthorityRequired:0,walletAmount:0,walletCurrency:wallet.currency
      });
      trace.push({type:"PRODUCT_FOUND",payload:{
        productId:product.id,title:product.title,merchant:product.merchant,
        merchantCountry:product.merchantCountry??"UNKNOWN",price:product.price,currency:product.currency,brand:product.brand
      }});
      trace.push({type:"AUTHORIZATION_CONTEXT_BLOCKED",payload:{productId:product.id,reason}});
      continue;
    }

    const product=authorized.product;
    const tx=authorized.transaction;
    trace.push({type:"PRODUCT_FOUND",payload:{
      productId:product.id,title:product.title,merchant:product.merchant,
      merchantCountry:authorized.context.merchantCountry,price:product.price,currency:product.currency,brand:product.brand
    }});

    if(authorized.context.payeeLock){
      trace.push({type:"PAYEE_IDENTITY_BOUND",payload:{
        productId:product.id,
        provider:authorized.context.payeeLock.provider,
        payeeId:authorized.context.payeeLock.payeeId,
        payeeType:authorized.context.payeeLock.payeeType,
        merchantCountry:authorized.context.payeeLock.merchantCountry,
        fingerprint:authorized.context.payeeLock.fingerprint,
        mode:authorized.context.payeeLock.mode,
        trustStatus:authorized.context.payeeLock.trustStatus,
        trustedLabel:authorized.context.payeeLock.trustedLabel
      }});
    }

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
      buyerCountry:authorized.context.buyerCountry,merchantCountry:authorized.context.merchantCountry,
      payeeFingerprint:authorized.context.payeeLock?.fingerprint??null
    }});
  }

  // Preserve connector relevance order. The old implementation re-sorted by
  // wallet cost, which effectively hard-coded "cheapest wins" even when the
  // marketplace ranked another listing as a better match to the user's request.
  const chosen=evaluated.find(x=>x.decision==='ALLOW')??evaluated.find(x=>x.decision==='STEP_UP');
  if(chosen?.product.authorizationContext){
    const tx=transactionFromAuthorizationContext(chosen.product,chosen.product.authorizationContext);
    const tightened=await assessAndTighten(env.DATABASE_URL,{
      sessionId,walletId:wallet.walletId,agentId:'intentlock-purchase-agent',merchant:chosen.product.merchant,
      amount:tx.amount,currency:tx.currency,policyDecision:chosen.decision,
      selectedMerchantMessage:chosen.product.merchantMessage,searchMerchantMessages:products.map(p=>p.merchantMessage??'')
    },evaluateWalletTransaction(wallet,tx));
    chosen.decision=tightened.evaluation.decision;
    chosen.reasons=tightened.evaluation.reasons;
    chosen.additionalAuthorityRequired=tightened.evaluation.additionalAuthorityRequired;
    trace.push({type:'AGENT_RISK_ASSESSED',payload:{assessmentId:tightened.assessment.assessmentId,riskAction:tightened.assessment.riskAction,trustScore:tightened.assessment.trustScore}});
  }
  const allowed=chosen?.decision==='ALLOW'?[chosen]:[];
  const stepUps=chosen?.decision==='STEP_UP'?[chosen]:[];

  if(allowed.length){
    const selected=allowed[0];
    await updateSession(env.DATABASE_URL,sessionId,{
      status:"READY_TO_PAY",selectedProduct:selected.product,selectedDecision:"ALLOW"
    });
    trace.push({type:"CANDIDATE_SELECTED",payload:{
      productId:selected.product.id,title:selected.product.title,
      presentmentAmount:selected.product.price,presentmentCurrency:selected.product.currency,
      walletAmount:selected.walletAmount,walletCurrency:selected.walletCurrency,
      payeeFingerprint:selected.product.authorizationContext?.payeeLock?.fingerprint??null,
      reason:"BEST_AUTHORIZED_MATCH_IN_DISCOVERY_ORDER"
    }});
    trace.push({type:"AUTO_AUTHORIZED",payload:{
      productId:selected.product.id,walletAmount:selected.walletAmount,walletCurrency:selected.walletCurrency,
      note:"Candidate is inside delegated authority after currency normalization and payee binding."
    }});
  }else if(stepUps.length){
    const selected=stepUps[0];
    if(!selected.product.authorizationContext) throw new Error("AUTHORIZATION_CONTEXT_MISSING");
    const c=selected.product.authorizationContext;
    const tx={
      productName:selected.product.title,category:selected.product.category,brand:selected.product.brand,
      amount:c.walletAmount,currency:c.walletCurrency,quantity:1,features:selected.product.features,
      presentmentAmount:c.presentmentAmount,presentmentCurrency:c.presentmentCurrency,
      buyerCountry:c.buyerCountry,merchantCountry:c.merchantCountry,
      fxQuoteId:c.fxQuote?.quoteId,fxRate:c.fxQuote?.rate,fxSource:c.fxQuote?.source,
      fxQuotedAt:c.fxQuote?.quotedAt,fxExpiresAt:c.fxQuote?.expiresAt,
      payeeProvider:c.payeeLock?.provider,payeeFingerprint:c.payeeLock?.fingerprint,recipientFingerprint:c.recipient?.fingerprint
    };
    const evaluation={...evaluateWalletTransaction(wallet,tx),decision:'STEP_UP' as const,additionalAuthorityRequired:selected.additionalAuthorityRequired,canAutoExecute:false,requiresHumanApproval:true};
    const stepUp=await issueStepUpRequest(env.DATABASE_URL,wallet,tx,evaluation);
    await updateSession(env.DATABASE_URL,sessionId,{
      status:"AWAITING_STEP_UP",selectedProduct:selected.product,selectedDecision:"STEP_UP",
      stepUpRequestId:stepUp?.requestId??null
    });
    trace.push({type:"CANDIDATE_SELECTED",payload:{
      productId:selected.product.id,title:selected.product.title,
      presentmentAmount:selected.product.price,presentmentCurrency:selected.product.currency,
      walletAmount:selected.walletAmount,walletCurrency:selected.walletCurrency,
      payeeFingerprint:c.payeeLock?.fingerprint??null,
      reason:"BEST_STEP_UP_MATCH_IN_DISCOVERY_ORDER"
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
  if(session.status!=='AWAITING_STEP_UP') throw new Error(`SESSION_NOT_AWAITING_STEP_UP:${session.status}`);
  if(!session.stepUpRequestId) throw new Error("SESSION_HAS_NO_STEP_UP_REQUEST");
  if(!env.APPROVAL_SIGNING_SECRET) throw new Error("APPROVAL_SIGNING_SECRET_NOT_CONFIGURED");
  const wallet=await getWallet(env.DATABASE_URL,session.walletId);
  if(!wallet) throw new Error("WALLET_NOT_FOUND");
  const result=await resolveStepUpRequest(env.DATABASE_URL,env.APPROVAL_SIGNING_SECRET,wallet,session.stepUpRequestId,action);

  if(action==="REJECT"){
    await addEvent(env.DATABASE_URL,sessionId,"STEP_UP_REJECTED",{requestId:session.stepUpRequestId});
  }else{
    await addEvent(env.DATABASE_URL,sessionId,action==="ALLOW_ONCE"?"STEP_UP_APPROVED_ONCE":"AUTO_LIMIT_RAISED",{
      requestId:session.stepUpRequestId,authorizationId:result.authorizationId??null,
      newAutoBuyLimit:result.newAutoBuyLimit??null,paymentAllowed:result.paymentAllowed
    });
  }

  return {result,session:await getSession(env.DATABASE_URL,sessionId),events:await getEvents(env.DATABASE_URL,sessionId)};
}
