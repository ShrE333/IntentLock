import {getWallet} from "../wallets/repository";
import {evaluateWalletTransaction} from "../wallets/policy";
import {connectorStatus,getCommerceConnectors} from "./registry";

const headers={
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type"
};

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});

type Env={
  DATABASE_URL?:string;
  COMMERCE_CATALOG_URL?:string;
  SHOPIFY_STORE_DOMAIN?:string;
  SHOPIFY_STOREFRONT_PUBLIC_TOKEN?:string;
  SHOPIFY_STOREFRONT_PRIVATE_TOKEN?:string;
  SHOPIFY_STOREFRONT_API_VERSION?:string;
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
    const connector=getCommerceConnectors(env)
      .find(c=>c.info().id==="shopify-storefront");

    if(!connector){
      return json({
        configured:false,
        reachable:false,
        connector:"shopify-storefront"
      });
    }

    try{
      const sample=await connector.search({query:"",limit:1});

      return json({
        configured:true,
        reachable:true,
        connector:connector.info(),
        sampleProduct:sample[0]??null
      });
    }catch(error){
      return json({
        configured:true,
        reachable:false,
        connector:connector.info(),
        message:error instanceof Error?error.message:String(error)
      },502);
    }
  }

  if(request.method==="POST" && url.pathname==="/api/commerce/search"){
    if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},500);

    try{
      const body:any=await request.json();
      const walletId=String(body.walletId??"");
      const query=String(body.query??"").trim();
      const connectorId=String(body.connectorId??"demo-marketplace");

      if(!walletId) return json({error:"WALLET_ID_REQUIRED"},400);
      if(!query) return json({error:"SEARCH_QUERY_REQUIRED"},400);

      const wallet=await getWallet(env.DATABASE_URL,walletId);
      if(!wallet) return json({error:"WALLET_NOT_FOUND"},404);

      const connector=getCommerceConnectors(env)
        .find(c=>c.info().id===connectorId);

      if(!connector) return json({error:"CONNECTOR_NOT_AVAILABLE"},400);

      const products=await connector.search({
        query,
        category:wallet.allowedCategories[0],
        brands:wallet.allowedBrands,
        maxPrice:wallet.maxSingleTransaction,
        requiredFeatures:wallet.requiredFeatures,
        limit:Number(body.limit??10)
      });

      const candidates=products.map(product=>{
        const evaluation=evaluateWalletTransaction(wallet,{
          productName:product.title,
          category:product.category,
          brand:product.brand,
          amount:product.price,
          currency:product.currency,
          quantity:1,
          features:product.features
        });

        return {
          product,
          policy:{
            decision:evaluation.decision,
            violations:evaluation.violations,
            reasons:evaluation.reasons,
            additionalAuthorityRequired:evaluation.additionalAuthorityRequired,
            canAutoExecute:evaluation.canAutoExecute,
            requiresHumanApproval:evaluation.requiresHumanApproval
          },
          merchantTextTrust:"UNTRUSTED",
          merchantMessage:product.merchantMessage??null
        };
      });

      return json({
        connector:connector.info(),
        wallet:{
          walletId:wallet.walletId,
          name:wallet.name,
          autoBuyLimit:wallet.autoBuyLimit,
          maxSingleTransaction:wallet.maxSingleTransaction
        },
        query,
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
