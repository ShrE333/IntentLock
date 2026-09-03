import {createWallet,listWallets,getWallet,recordDecision} from "./repository";
import {evaluateWalletTransaction} from "./policy";
import {issueStepUpRequest,resolveStepUpRequest} from "./stepup";

const headers={
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const list=(v:unknown)=>Array.isArray(v)?v.map(String):[];

type WalletEnv={
  DATABASE_URL?:string;
  APPROVAL_SIGNING_SECRET?:string;
};

export async function handleWalletRoutes(request:Request,env:WalletEnv,url:URL):Promise<Response|null>{
  if(!url.pathname.startsWith("/api/wallets")) return null;
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers});
  if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},500);

  try{
    if(request.method==="GET" && url.pathname==="/api/wallets"){
      const wallets=await listWallets(env.DATABASE_URL);
      return json({wallets,count:wallets.length});
    }

    if(request.method==="POST" && url.pathname==="/api/wallets"){
      const b:any=await request.json();
      const totalAuthority=Number(b.totalAuthority);
      const autoBuyLimit=Number(b.autoBuyLimit);
      const maxSingleTransaction=Number(b.maxSingleTransaction);

      if(!b.name || totalAuthority<=0 || autoBuyLimit<0 || maxSingleTransaction<=0)
        return json({error:"INVALID_WALLET_LIMITS"},400);

      if(autoBuyLimit>maxSingleTransaction || maxSingleTransaction>totalAuthority)
        return json({error:"INVALID_AUTHORITY_HIERARCHY"},400);

      if(new Date(b.validUntil).getTime()<=Date.now())
        return json({error:"INVALID_EXPIRY"},400);

      const wallet=await createWallet(env.DATABASE_URL,{
        name:String(b.name),
        currency:String(b.currency??"INR").toUpperCase(),
        totalAuthority,
        autoBuyLimit,
        maxSingleTransaction,
        allowedCategories:list(b.allowedCategories),
        allowedBrands:list(b.allowedBrands),
        blockedBrands:list(b.blockedBrands),
        requiredFeatures:list(b.requiredFeatures),
        validUntil:new Date(b.validUntil).toISOString()
      });

      return json({ok:true,wallet},201);
    }

    const evalMatch=url.pathname.match(/^\/api\/wallets\/([^/]+)\/evaluate$/);
    if(request.method==="POST" && evalMatch){
      const walletId=decodeURIComponent(evalMatch[1]);
      const wallet=await getWallet(env.DATABASE_URL,walletId);
      if(!wallet) return json({error:"WALLET_NOT_FOUND"},404);

      const b:any=await request.json();
      const tx={
        productName:b.productName?String(b.productName):undefined,
        category:String(b.category??""),
        brand:String(b.brand??""),
        amount:Number(b.amount),
        currency:String(b.currency??"INR").toUpperCase(),
        quantity:Number(b.quantity??1),
        features:list(b.features)
      };

      const evaluation=evaluateWalletTransaction(wallet,tx);
      const decisionId=await recordDecision(env.DATABASE_URL,walletId,tx,evaluation);

      const stepUp=evaluation.decision==="STEP_UP"
        ? await issueStepUpRequest(env.DATABASE_URL,wallet,tx,evaluation)
        : null;

      return json({
        walletId,
        decisionId,
        transaction:tx,
        evaluation,
        stepUp
      });
    }

    const resolveMatch=url.pathname.match(
      /^\/api\/wallets\/([^/]+)\/step-up\/([^/]+)\/resolve$/
    );

    if(request.method==="POST" && resolveMatch){
      if(!env.APPROVAL_SIGNING_SECRET)
        return json({error:"APPROVAL_SIGNING_SECRET_NOT_CONFIGURED"},500);

      const walletId=decodeURIComponent(resolveMatch[1]);
      const requestId=decodeURIComponent(resolveMatch[2]);

      const wallet=await getWallet(env.DATABASE_URL,walletId);
      if(!wallet) return json({error:"WALLET_NOT_FOUND"},404);

      const b:any=await request.json();
      const action=String(b.action??"").toUpperCase();

      if(!["ALLOW_ONCE","RAISE_LIMIT","REJECT"].includes(action))
        return json({error:"INVALID_STEP_UP_ACTION"},400);

      const result=await resolveStepUpRequest(
        env.DATABASE_URL,
        env.APPROVAL_SIGNING_SECRET,
        wallet,
        requestId,
        action as "ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT"
      );

      return json({
        ok:true,
        walletId,
        requestId,
        result
      });
    }

    return json({error:"WALLET_ROUTE_NOT_FOUND"},404);
  }catch(error){
    return json({
      error:"WALLET_REQUEST_FAILED",
      message:error instanceof Error?error.message:String(error)
    },400);
  }
}
