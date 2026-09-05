import {listWallets,getWallet} from "../wallets/repository";
import {createSession,addEvents,getSession} from "../sessions/repository";
import {resolveSessionStepUp} from "../sessions/orchestrator";
import {connectorStatus} from "../commerce/registry";
import {
  ensureChatState,getChatState,setActiveWallet,setActiveSession
} from "./repository";
import {parseWhatsappCommand} from "./commands";
import {sendWahaText} from "./waha-client";
import type {PurchaseQueueJob} from "../queue/purchase-jobs";

type Env={
  DATABASE_URL:string;
  APPROVAL_SIGNING_SECRET?:string;
  COMMERCE_CATALOG_URL?:string;
  SHOPIFY_STORE_DOMAIN?:string;
  SHOPIFY_STOREFRONT_PUBLIC_TOKEN?:string;
  SHOPIFY_STOREFRONT_PRIVATE_TOKEN?:string;
  SHOPIFY_STOREFRONT_API_VERSION?:string;
  WAHA_BASE_URL:string;
  WAHA_API_KEY:string;
  UPSTASH_REDIS_REST_URL?:string;
  UPSTASH_REDIS_REST_TOKEN?:string;
  RAZORPAY_KEY_ID?:string;
  RAZORPAY_KEY_SECRET?:string;
  RAZORPAY_WEBHOOK_SECRET?:string;

  PURCHASE_QUEUE:{
    send(job:PurchaseQueueJob):Promise<unknown>;
  };
};

async function reply(
  env:Env,
  chatId:string,
  session:string,
  text:string
){
  return sendWahaText({
    baseUrl:env.WAHA_BASE_URL,
    apiKey:env.WAHA_API_KEY,
    session,
    chatId,
    text
  });
}

function walletLine(w:any,index:number){
  return `${index+1}. ${w.name}\n   Auto ≤ ₹${Number(w.autoBuyLimit).toLocaleString("en-IN")} · Hard ≤ ₹${Number(w.maxSingleTransaction).toLocaleString("en-IN")}`;
}

export async function handleWhatsappMessage(
  env:Env,
  input:{chatId:string;wahaSession:string;text:string}
){
  let state=await ensureChatState(
    env.DATABASE_URL,
    input.chatId,
    input.wahaSession
  );

  const cmd=parseWhatsappCommand(input.text);

  if(cmd.type==="HELP"){
    await reply(env,input.chatId,input.wahaSession,
`🔐 *IntentLock*

Delegated AI commerce over WhatsApp.

*Commands*
WALLETS — show Intent Wallets
USE 1 — select a wallet
WALLET — show active authority
STATUS — active purchase session

Then just type your purchase goal:
_Find Sony or Bose wireless ANC headphones under ₹7,000. Buy automatically if allowed._

For step-up requests:
ALLOW ONCE
RAISE LIMIT
REJECT`);
    return;
  }

  if(cmd.type==="WALLETS"){
    const wallets=(await listWallets(env.DATABASE_URL))
      .filter((w:any)=>w.status==="ACTIVE")
      .slice(0,8);

    if(!wallets.length){
      await reply(env,input.chatId,input.wahaSession,
        "No active Intent Wallets found. Create one in the IntentLock dashboard first.");
      return;
    }

    await reply(env,input.chatId,input.wahaSession,
`💳 *Intent Wallets*

${wallets.map(walletLine).join("\n\n")}

Reply *USE 1* to select one.`);
    return;
  }

  if(cmd.type==="USE_WALLET"){
    const wallets=(await listWallets(env.DATABASE_URL))
      .filter((w:any)=>w.status==="ACTIVE");

    let selected:any=null;
    const asNumber=Number(cmd.selector);

    if(Number.isInteger(asNumber) && asNumber>=1 && asNumber<=wallets.length){
      selected=wallets[asNumber-1];
    } else {
      selected=wallets.find((w:any)=>
        w.walletId===cmd.selector ||
        w.name.toLowerCase()===cmd.selector.toLowerCase()
      );
    }

    if(!selected){
      await reply(env,input.chatId,input.wahaSession,
        "I couldn't find that wallet. Reply *WALLETS* to see available choices.");
      return;
    }

    state=(await setActiveWallet(
      env.DATABASE_URL,
      input.chatId,
      selected.walletId
    ))!;

    await reply(env,input.chatId,input.wahaSession,
`✅ *Intent Wallet selected*

${selected.name}

Total authority: ₹${Number(selected.totalAuthority).toLocaleString("en-IN")}
Remaining: ₹${Number(selected.totalAuthority-selected.spentAmount).toLocaleString("en-IN")}
Auto-buy: ≤ ₹${Number(selected.autoBuyLimit).toLocaleString("en-IN")}
Hard ceiling: ≤ ₹${Number(selected.maxSingleTransaction).toLocaleString("en-IN")}
Allowed: ${selected.allowedBrands.join(", ")||"Any"}
Blocked: ${selected.blockedBrands.join(", ")||"None"}

Now send your purchase goal.`);
    return;
  }

  if(cmd.type==="WALLET"){
    if(!state.activeWalletId){
      await reply(env,input.chatId,input.wahaSession,
        "No wallet selected. Reply *WALLETS*, then *USE 1*.");
      return;
    }

    const wallet=await getWallet(env.DATABASE_URL,state.activeWalletId);
    if(!wallet){
      await reply(env,input.chatId,input.wahaSession,
        "The selected wallet no longer exists. Reply *WALLETS*.");
      return;
    }

    await reply(env,input.chatId,input.wahaSession,
`💳 *${wallet.name}*

Remaining: ₹${Number(wallet.totalAuthority-wallet.spentAmount).toLocaleString("en-IN")}
Auto-buy: ≤ ₹${Number(wallet.autoBuyLimit).toLocaleString("en-IN")}
Hard ceiling: ≤ ₹${Number(wallet.maxSingleTransaction).toLocaleString("en-IN")}
Allowed: ${wallet.allowedBrands.join(", ")||"Any"}
Blocked: ${wallet.blockedBrands.join(", ")||"None"}
Required: ${wallet.requiredFeatures.join(", ")||"None"}`);
    return;
  }

  if(cmd.type==="STATUS"){
    if(!state.activeSessionId){
      await reply(env,input.chatId,input.wahaSession,
        "No active purchase session yet.");
      return;
    }

    const session=await getSession(env.DATABASE_URL,state.activeSessionId);
    if(!session){
      await reply(env,input.chatId,input.wahaSession,
        "The previous session is unavailable.");
      return;
    }

    await reply(env,input.chatId,input.wahaSession,
`🤖 *Purchase Session*

${session.sessionId}
Status: *${session.status}*
Decision: ${session.selectedDecision??"PENDING"}
Product: ${session.selectedProduct?.title??"Not selected"}
Amount: ${session.selectedProduct?`₹${session.selectedProduct.price.toLocaleString("en-IN")}`:"-"}`);
    return;
  }

  if(cmd.type==="RESET"){
    await setActiveSession(env.DATABASE_URL,input.chatId,null);
    await reply(env,input.chatId,input.wahaSession,
      "Session cleared. Your selected Intent Wallet remains active.");
    return;
  }

  if(["ALLOW_ONCE","RAISE_LIMIT","REJECT"].includes(cmd.type)){
    if(!state.activeSessionId){
      await reply(env,input.chatId,input.wahaSession,
        "There is no active Step-Up request.");
      return;
    }

    const action=cmd.type as "ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT";

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
      state.activeSessionId,
      action
    );

    if(action==="REJECT"){
      await reply(env,input.chatId,input.wahaSession,
`❌ *Step-Up rejected*

Session: ${result.session?.sessionId}
Money movement remains disabled.`);
      return;
    }

    if(!env.PURCHASE_QUEUE)
      throw new Error("PURCHASE_QUEUE_NOT_CONFIGURED");

    await env.PURCHASE_QUEUE.send({
      kind:"CREATE_PAYMENT",
      sessionId:result.session!.sessionId,
      chatId:input.chatId,
      wahaSession:input.wahaSession
    });

    await reply(env,input.chatId,input.wahaSession,
`✅ *Authority granted*

Session: ${result.session?.sessionId}
Resolution: ${String(result.result.decision).replaceAll("_"," ")}

${action==="ALLOW_ONCE"
  ? "The exact one-time authorization is attached to this PurchaseSession."
  : `The autonomous limit is now ₹${Number(result.result.newAutoBuyLimit).toLocaleString("en-IN")}.`}

Preparing the Razorpay checkout now…`);
    return;
  }

  if(cmd.type==="BUY"){
    if(!state.activeWalletId){
      await reply(env,input.chatId,input.wahaSession,
`Before I can spend, I need bounded authority.

Reply *WALLETS*, then *USE 1* to choose an Intent Wallet.`);
      return;
    }

    const activeConnector=connectorStatus(env).find(c=>c.enabled);
    if(!activeConnector){
      await reply(env,input.chatId,input.wahaSession,
        "No commerce connector is currently available.");
      return;
    }

    const purchase=await createSession(env.DATABASE_URL,{
      walletId:state.activeWalletId,
      channel:"WHATSAPP",
      connectorId:activeConnector.id,
      userPrompt:cmd.prompt
    });

    await setActiveSession(env.DATABASE_URL,input.chatId,purchase.sessionId);

    const wallet=await getWallet(env.DATABASE_URL,state.activeWalletId);

    await addEvents(
      env.DATABASE_URL,
      purchase.sessionId,
      [
        {
          type:"SESSION_CREATED",
          payload:{
            channel:"WHATSAPP",
            connectorId:activeConnector.id,
            chatId:input.chatId
          }
        },
        {
          type:"WALLET_ATTACHED",
          payload:{
            walletId:wallet?.walletId,
            walletName:wallet?.name,
            totalAuthority:wallet?.totalAuthority,
            autoBuyLimit:wallet?.autoBuyLimit,
            maxSingleTransaction:wallet?.maxSingleTransaction
          }
        },
        {
          type:"USER_INTENT_RECEIVED",
          payload:{
            prompt:cmd.prompt,
            channel:"WHATSAPP"
          }
        }
      ]
    );

    if(!env.PURCHASE_QUEUE)
      throw new Error("PURCHASE_QUEUE_NOT_CONFIGURED");

    // The webhook invocation ends after this enqueue + acknowledgement.
    // Shopify search, policy evaluation, audit and Razorpay run in a fresh
    // Queue consumer invocation with its own Cloudflare subrequest budget.
    await env.PURCHASE_QUEUE.send({
      kind:"RUN_PURCHASE",
      sessionId:purchase.sessionId,
      chatId:input.chatId,
      wahaSession:input.wahaSession
    });

    await reply(env,input.chatId,input.wahaSession,
`🤖 *IntentLock Agent started*

Session: ${purchase.sessionId}
Wallet: ${wallet?.name}
Goal: ${cmd.prompt}

Searching live Shopify and evaluating every candidate against your authority…`);

    return;
  }
}
