import {getWallet} from "../wallets/repository";
import {connectorStatus} from "../commerce/registry";
import {
  addEvent,createSession,getEvents,getSession,listSessions
} from "./repository";
import {runPurchaseSession,resolveSessionStepUp} from "./orchestrator";

const headers={
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});

type Env={
  DATABASE_URL?:string;
  APPROVAL_SIGNING_SECRET?:string;
  COMMERCE_CATALOG_URL?:string;
  SHOPIFY_STORE_DOMAIN?:string;
  SHOPIFY_STOREFRONT_PUBLIC_TOKEN?:string;
  SHOPIFY_STOREFRONT_PRIVATE_TOKEN?:string;
  SHOPIFY_STOREFRONT_API_VERSION?:string;
};

export async function handleSessionRoutes(
  request:Request,env:Env,url:URL
):Promise<Response|null>{
  if(!url.pathname.startsWith("/api/sessions")) return null;
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers});
  if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},500);

  try{
    if(request.method==="GET" && url.pathname==="/api/sessions"){
      return json({sessions:await listSessions(env.DATABASE_URL)});
    }

    if(request.method==="POST" && url.pathname==="/api/sessions"){
      const b:any=await request.json();
      const walletId=String(b.walletId??"");
      const prompt=String(b.prompt??"").trim();
      const connectorId=String(b.connectorId??"demo-marketplace");
      const channel=String(b.channel??"WEB").toUpperCase();

      if(!walletId) return json({error:"WALLET_ID_REQUIRED"},400);
      if(!prompt) return json({error:"PROMPT_REQUIRED"},400);
      if(!["WEB","WHATSAPP","API"].includes(channel))
        return json({error:"INVALID_CHANNEL"},400);

      const wallet=await getWallet(env.DATABASE_URL,walletId);
      if(!wallet) return json({error:"WALLET_NOT_FOUND"},404);

      const connector=connectorStatus(env).find(c=>c.id===connectorId && c.enabled);
      if(!connector) return json({error:"CONNECTOR_NOT_AVAILABLE"},400);

      const session=await createSession(env.DATABASE_URL,{
        walletId,
        userPrompt:prompt,
        connectorId,
        channel:channel as "WEB"|"WHATSAPP"|"API"
      });

      await addEvent(env.DATABASE_URL,session.sessionId,"SESSION_CREATED",{
        channel,connectorId
      });
      await addEvent(env.DATABASE_URL,session.sessionId,"WALLET_ATTACHED",{
        walletId:wallet.walletId,
        walletName:wallet.name,
        totalAuthority:wallet.totalAuthority,
        autoBuyLimit:wallet.autoBuyLimit,
        maxSingleTransaction:wallet.maxSingleTransaction
      });
      await addEvent(env.DATABASE_URL,session.sessionId,"USER_INTENT_RECEIVED",{
        prompt
      });

      return json({
        session,
        events:await getEvents(env.DATABASE_URL,session.sessionId)
      },201);
    }

    const runMatch=url.pathname.match(/^\/api\/sessions\/([^/]+)\/run$/);
    if(request.method==="POST" && runMatch){
      const sessionId=decodeURIComponent(runMatch[1]);
      const result=await runPurchaseSession(
        {
          DATABASE_URL:env.DATABASE_URL,
          APPROVAL_SIGNING_SECRET:env.APPROVAL_SIGNING_SECRET,
          COMMERCE_CATALOG_URL:env.COMMERCE_CATALOG_URL,
          SHOPIFY_STORE_DOMAIN:env.SHOPIFY_STORE_DOMAIN,
          SHOPIFY_STOREFRONT_PUBLIC_TOKEN:env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN,
          SHOPIFY_STOREFRONT_PRIVATE_TOKEN:env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
          SHOPIFY_STOREFRONT_API_VERSION:env.SHOPIFY_STOREFRONT_API_VERSION
        },
        sessionId
      );
      return json(result);
    }

    const resolveMatch=url.pathname.match(
      /^\/api\/sessions\/([^/]+)\/step-up\/resolve$/
    );
    if(request.method==="POST" && resolveMatch){
      const sessionId=decodeURIComponent(resolveMatch[1]);
      const b:any=await request.json();
      const action=String(b.action??"").toUpperCase();
      if(!["ALLOW_ONCE","RAISE_LIMIT","REJECT"].includes(action))
        return json({error:"INVALID_STEP_UP_ACTION"},400);

      const result=await resolveSessionStepUp(
        {
          DATABASE_URL:env.DATABASE_URL,
          APPROVAL_SIGNING_SECRET:env.APPROVAL_SIGNING_SECRET,
          COMMERCE_CATALOG_URL:env.COMMERCE_CATALOG_URL,
          SHOPIFY_STORE_DOMAIN:env.SHOPIFY_STORE_DOMAIN,
          SHOPIFY_STOREFRONT_PUBLIC_TOKEN:env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN,
          SHOPIFY_STOREFRONT_PRIVATE_TOKEN:env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
          SHOPIFY_STOREFRONT_API_VERSION:env.SHOPIFY_STOREFRONT_API_VERSION
        },
        sessionId,
        action as "ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT"
      );
      return json(result);
    }

    const sessionMatch=url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if(request.method==="GET" && sessionMatch){
      const sessionId=decodeURIComponent(sessionMatch[1]);
      const session=await getSession(env.DATABASE_URL,sessionId);
      if(!session) return json({error:"SESSION_NOT_FOUND"},404);
      return json({
        session,
        events:await getEvents(env.DATABASE_URL,sessionId)
      });
    }

    return json({error:"SESSION_ROUTE_NOT_FOUND"},404);
  }catch(error){
    return json({
      error:"SESSION_REQUEST_FAILED",
      message:error instanceof Error?error.message:String(error)
    },400);
  }
}
