import type {WahaWebhook} from "./types";
import {claimWebhookEvent} from "./repository";
import {handleWhatsappMessage} from "./service";
import {verifyWahaWebhookHmac,sendWahaText} from "./waha-client";
import {
  isWhatsappChatAuthorized,
  authorizeWhatsappChat,
  revokeWhatsappChat,
  extractPairingCode,
  pairingCodeMatches,
  isWhatsappStopCommand
} from "./access";

const jsonHeaders={"content-type":"application/json; charset=utf-8"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:jsonHeaders});

type Env={
  DATABASE_URL?:string;
  APPROVAL_SIGNING_SECRET?:string;
  COMMERCE_CATALOG_URL?:string;
  SHOPIFY_STORE_DOMAIN?:string;
  SHOPIFY_STOREFRONT_PUBLIC_TOKEN?:string;
  SHOPIFY_STOREFRONT_PRIVATE_TOKEN?:string;
  SHOPIFY_STOREFRONT_API_VERSION?:string;

  WAHA_BASE_URL?:string;
  WAHA_API_KEY?:string;
  WAHA_WEBHOOK_SECRET?:string;
  WAHA_PAIRING_CODE?:string;

  UPSTASH_REDIS_REST_URL?:string;
  UPSTASH_REDIS_REST_TOKEN?:string;
  RAZORPAY_KEY_ID?:string;
  RAZORPAY_KEY_SECRET?:string;
  RAZORPAY_WEBHOOK_SECRET?:string;
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
      channel:"WHATSAPP",
      inboundAccess:"PAIRING_REQUIRED",
      pairingConfigured:Boolean(env.WAHA_PAIRING_CODE)
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

  // Keep this channel focused on 1:1 chats.
  if(chatId.endsWith("@g.us") || chatId.endsWith("@newsletter"))
    return json({ok:true,ignored:"non_direct_chat"});

  // V10.8: silent-by-default inbound access.
  // Unauthorized chats are not persisted and receive no bot response.
  const authorized=await isWhatsappChatAuthorized(
    env.DATABASE_URL,
    chatId
  );

  if(!authorized){
    const supplied=extractPairingCode(body);

    if(
      !pairingCodeMatches(
        supplied,
        env.WAHA_PAIRING_CODE
      )
    ){
      return json({
        ok:true,
        ignored:"unauthorized_chat"
      });
    }

    await authorizeWhatsappChat(
      env.DATABASE_URL,
      chatId,
      "WhatsApp paired user"
    );

    await sendWahaText({
      baseUrl:env.WAHA_BASE_URL,
      apiKey:env.WAHA_API_KEY,
      session:String(event.session??"default"),
      chatId,
      text:
`🔐 *IntentLock access enabled*

This WhatsApp chat is now authorized for delegated commerce.

Reply *HELP* to begin.

To revoke access later, send:
*INTENTLOCK STOP*`
    });

    return json({
      ok:true,
      paired:true
    });
  }

  if(isWhatsappStopCommand(body)){
    await sendWahaText({
      baseUrl:env.WAHA_BASE_URL,
      apiKey:env.WAHA_API_KEY,
      session:String(event.session??"default"),
      chatId,
      text:"🔒 IntentLock access revoked for this WhatsApp chat."
    });

    await revokeWhatsappChat(
      env.DATABASE_URL,
      chatId
    );

    return json({
      ok:true,
      revoked:true
    });
  }

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
        SHOPIFY_STORE_DOMAIN:env.SHOPIFY_STORE_DOMAIN,
        SHOPIFY_STOREFRONT_PUBLIC_TOKEN:env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN,
        SHOPIFY_STOREFRONT_PRIVATE_TOKEN:env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
        SHOPIFY_STOREFRONT_API_VERSION:env.SHOPIFY_STOREFRONT_API_VERSION,
        WAHA_BASE_URL:env.WAHA_BASE_URL,
        WAHA_API_KEY:env.WAHA_API_KEY,
        UPSTASH_REDIS_REST_URL:env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN:env.UPSTASH_REDIS_REST_TOKEN,
        RAZORPAY_KEY_ID:env.RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET:env.RAZORPAY_KEY_SECRET,
        RAZORPAY_WEBHOOK_SECRET:env.RAZORPAY_WEBHOOK_SECRET
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
