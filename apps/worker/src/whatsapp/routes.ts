import type {WahaWebhook} from "./types";
import {claimWebhookEvent} from "./repository";
import {handleWhatsappMessage} from "./service";
import {verifyWahaWebhookHmac} from "./waha-client";

const jsonHeaders={"content-type":"application/json; charset=utf-8"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:jsonHeaders});

type Env={
  DATABASE_URL?:string;
  APPROVAL_SIGNING_SECRET?:string;
  COMMERCE_CATALOG_URL?:string;

  WAHA_BASE_URL?:string;
  WAHA_API_KEY?:string;
  WAHA_WEBHOOK_SECRET?:string;
};

export async function handleWhatsappRoutes(
  request:Request,
  env:Env,
  url:URL
):Promise<Response|null>{
  if(url.pathname==="/api/whatsapp/status" && request.method==="GET"){
    return json({
      configured:Boolean(
        env.DATABASE_URL &&
        env.WAHA_BASE_URL &&
        env.WAHA_API_KEY &&
        env.WAHA_WEBHOOK_SECRET
      ),
      webhookPath:"/webhooks/waha",
      channel:"WHATSAPP"
    });
  }

  if(url.pathname!=="/webhooks/waha") return null;
  if(request.method!=="POST") return json({error:"METHOD_NOT_ALLOWED"},405);

  if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},500);
  if(!env.WAHA_BASE_URL || !env.WAHA_API_KEY || !env.WAHA_WEBHOOK_SECRET)
    return json({error:"WAHA_NOT_CONFIGURED"},500);

  const raw=await request.text();

  const valid=await verifyWahaWebhookHmac(
    env.WAHA_WEBHOOK_SECRET,
    raw,
    request.headers.get("X-Webhook-Hmac"),
    request.headers.get("X-Webhook-Hmac-Algorithm")
  );

  if(!valid) return json({error:"INVALID_WAHA_HMAC"},401);

  let event:WahaWebhook;
  try{
    event=JSON.parse(raw) as WahaWebhook;
  }catch{
    return json({error:"INVALID_JSON"},400);
  }

  // Subscribe only to message, but safely ignore anything else.
  if(event.event!=="message") return json({ok:true,ignored:event.event??"unknown"});

  const payload=event.payload??{};

  // Never recursively process IntentLock's own outgoing messages.
  if(payload.fromMe) return json({ok:true,ignored:"fromMe"});

  const chatId=String(payload.from??"");
  const body=String(payload.body??"").trim();
  const messageId=payload.id?String(payload.id):null;

  if(!chatId) return json({ok:true,ignored:"missing_chat"});
  if(!body) return json({ok:true,ignored:"non_text_or_empty"});

  // Keep this hackathon channel focused on 1:1 chats.
  if(chatId.endsWith("@g.us") || chatId.endsWith("@newsletter"))
    return json({ok:true,ignored:"non_direct_chat"});

  const eventId=String(
    event.id ??
    messageId ??
    `waha_${await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))
      .then(buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join(""))}`
  );

  const claimed=await claimWebhookEvent(
    env.DATABASE_URL,
    eventId,
    messageId,
    chatId,
    "message",
    event
  );

  if(!claimed) return json({ok:true,duplicate:true});

  try{
    await handleWhatsappMessage(
      {
        DATABASE_URL:env.DATABASE_URL,
        APPROVAL_SIGNING_SECRET:env.APPROVAL_SIGNING_SECRET,
        COMMERCE_CATALOG_URL:env.COMMERCE_CATALOG_URL,
        WAHA_BASE_URL:env.WAHA_BASE_URL,
        WAHA_API_KEY:env.WAHA_API_KEY
      },
      {
        chatId,
        wahaSession:String(event.session??"default"),
        text:body
      }
    );

    return json({ok:true});
  }catch(error){
    console.error("WhatsApp handling failed",error);

    return json({
      error:"WHATSAPP_HANDLER_FAILED",
      message:error instanceof Error?error.message:String(error)
    },500);
  }
}
