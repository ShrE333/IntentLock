import {getWallet} from "../wallets/repository";
import {evaluateWalletTransaction} from "../wallets/policy";
import {authorizeProductContext,type AuthorizationContextEnv} from "../payments/authorization-context";
import {connectorStatus,getCommerceConnectors,type CommerceEnv} from "./registry";
import {planCommerceSearchQuery} from "./query-planner";

const headers={
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type"
};

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});

type Env=AuthorizationContextEnv & CommerceEnv & {
  DATABASE_URL?:string;
};

export async function handleCommerceRoutes(
  request:Request,
  env:Env,
  url:URL
):Promise<Response|null>{
  if(!url.pathname.startsWith("/api/commerce")) return null;
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers});

  if(request.method==="GET" && url.pathname==="/api/commerce/connectors"){
    return json({connectors:connectorStatus(env)});
  }

  if(request.method==="GET" && url.pathname==="/api/commerce/shopify/status"){
    const connector=getCommerceConnectors(env).find(c=>c.info().id==="shopify-storefront");
    if(!connector){
      return json({configured:false,reachable:false,connector:"shopify-storefront"});
    }
    try{
      const sample=await connector.search({query:"",limit:1});
      return json({configured:true,reachable:true,connector:connector.info(),sampleProduct:sample[0]??null});
    }catch(error){
      return json({
        configured:true,reachable:false,connector:connector.info(),
        message:error instanceof Error?error.message:String(error)
      },502);
    }
  }

  if(request.method==="POST" && url.pathname==="/api/commerce/search"){
    if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},500);
    try{
      const body:any=await request.json();
      const walletId=String(body.walletId??"");
      const rawQuery=String(body.query??"").trim();
      const connectorId=String(body.connectorId??"demo-marketplace");
      if(!walletId) return json({error:"WALLET_ID_REQUIRED"},400);
      if(!rawQuery) return json({error:"SEARCH_QUERY_REQUIRED"},400);

      const wallet=await getWallet(env.DATABASE_URL,walletId);
      if(!wallet) return json({error:"WALLET_NOT_FOUND"},404);
      const connector=getCommerceConnectors(env).find(c=>c.info().id===connectorId);
      if(!connector) return json({error:"CONNECTOR_NOT_AVAILABLE"},400);

      // Search is based only on user product intent. Wallet rules are never sent
      // to a marketplace as hidden filters; policy is applied after candidates
      // return so ALLOW/STEP_UP/BLOCK remains independently explainable.
      const searchQuery=planCommerceSearchQuery(rawQuery);
      const products=await connector.search({
        query:searchQuery,
        limit:Number(body.limit??10)
      });

      const candidates=[] as any[];
      for(const rawProduct of products){
        try{
          const normalized=await authorizeProductContext(env,wallet,rawProduct);
          const evaluation=evaluateWalletTransaction(wallet,normalized.transaction);
          candidates.push({
            product:normalized.product,
            walletAmount:normalized.transaction.amount,
            walletCurrency:normalized.transaction.currency,
            fxQuote:normalized.context.fxQuote,
            policy:{
              decision:evaluation.decision,
              violations:evaluation.violations,
              reasons:evaluation.reasons,
              additionalAuthorityRequired:evaluation.additionalAuthorityRequired,
              canAutoExecute:evaluation.canAutoExecute,
              requiresHumanApproval:evaluation.requiresHumanApproval
            },
            merchantTextTrust:"UNTRUSTED",
            merchantMessage:rawProduct.merchantMessage??null
          });
        }catch(error){
          candidates.push({
            product:rawProduct,
            walletAmount:null,
            walletCurrency:wallet.currency,
            fxQuote:null,
            policy:{
              decision:"BLOCK",violations:["AUTHORIZATION_CONTEXT_UNAVAILABLE"],
              reasons:[error instanceof Error?error.message:String(error)],
              additionalAuthorityRequired:0,canAutoExecute:false,requiresHumanApproval:false
            },
            merchantTextTrust:"UNTRUSTED",
            merchantMessage:rawProduct.merchantMessage??null
          });
        }
      }

      return json({
        connector:connector.info(),
        wallet:{
          walletId:wallet.walletId,name:wallet.name,countryCode:wallet.countryCode,
          currency:wallet.currency,autoBuyLimit:wallet.autoBuyLimit,
          maxSingleTransaction:wallet.maxSingleTransaction
        },
        query:rawQuery,
        searchQuery,
        discoveryPolicySeparation:true,
        count:candidates.length,
        candidates
      });
    }catch(error){
      return json({
        error:"COMMERCE_SEARCH_FAILED",
        message:error instanceof Error?error.message:String(error)
      },400);
    }
  }

  return json({error:"COMMERCE_ROUTE_NOT_FOUND"},404);
}
