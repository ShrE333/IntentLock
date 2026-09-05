import {listWallets,getWallet} from "../wallets/repository";
import {createSession,addEvent,getSession,getEvents} from "../sessions/repository";
import {runPurchaseSession,resolveSessionStepUp} from "../sessions/orchestrator";
import {connectorStatus} from "../commerce/registry";
import {
  ensureChatState,getChatState,setActiveWallet,setActiveSession
} from "./repository";
import {parseWhatsappCommand} from "./commands";
import {sendWahaText} from "./waha-client";
import {createPaymentLinkForSession} from "../session-payments/service";

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

function candidateLine(c:any){
  const p=c.product;
  const icon=c.decision==="ALLOW"?"✅":c.decision==="STEP_UP"?"⚠️":"❌";
  const detail=c.decision==="BLOCK"
    ? c.violations.join(", ")
    : c.decision==="STEP_UP"
      ? `+₹${Number(c.additionalAuthorityRequired).toLocaleString("en-IN")} approval`
      : "autonomous";
  return `${icon} ${p.brand} · ₹${Number(p.price).toLocaleString("en-IN")} · ${detail}`;
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

    const payment=await createPaymentLinkForSession(
      {
        DATABASE_URL:env.DATABASE_URL,
        APPROVAL_SIGNING_SECRET:env.APPROVAL_SIGNING_SECRET,
        UPSTASH_REDIS_REST_URL:env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN:env.UPSTASH_REDIS_REST_TOKEN,
        RAZORPAY_KEY_ID:env.RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET:env.RAZORPAY_KEY_SECRET,
        RAZORPAY_WEBHOOK_SECRET:env.RAZORPAY_WEBHOOK_SECRET,
        SHOPIFY_STORE_DOMAIN:env.SHOPIFY_STORE_DOMAIN,
        SHOPIFY_STOREFRONT_PUBLIC_TOKEN:env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN,
        SHOPIFY_STOREFRONT_PRIVATE_TOKEN:env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
        SHOPIFY_STOREFRONT_API_VERSION:env.SHOPIFY_STOREFRONT_API_VERSION,
        WAHA_BASE_URL:env.WAHA_BASE_URL,
        WAHA_API_KEY:env.WAHA_API_KEY
      },
      result.session!.sessionId
    );

    await reply(env,input.chatId,input.wahaSession,
`✅ *Authority granted*

Session: ${result.session?.sessionId}
Resolution: ${String(result.result.decision).replaceAll("_"," ")}

💳 *Razorpay checkout ready*
${payment.paymentLink?.shortUrl}

${action==="ALLOW_ONCE"
  ? "The exact one-time authorization will be consumed by this checkout."
  : `The autonomous limit is now ₹${Number(result.result.newAutoBuyLimit).toLocaleString("en-IN")}.`}

IntentLock will mark the session CAPTURED only after Razorpay's verified webhook.`);
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

    await addEvent(env.DATABASE_URL,purchase.sessionId,"SESSION_CREATED",{
      channel:"WHATSAPP",
      connectorId:activeConnector.id,
      chatId:input.chatId
    });

    await addEvent(env.DATABASE_URL,purchase.sessionId,"WALLET_ATTACHED",{
      walletId:wallet?.walletId,
      walletName:wallet?.name,
      totalAuthority:wallet?.totalAuthority,
      autoBuyLimit:wallet?.autoBuyLimit,
      maxSingleTransaction:wallet?.maxSingleTransaction
    });

    await addEvent(env.DATABASE_URL,purchase.sessionId,"USER_INTENT_RECEIVED",{
      prompt:cmd.prompt,
      channel:"WHATSAPP"
    });

    await reply(env,input.chatId,input.wahaSession,
`🤖 *IntentLock Agent started*

Session: ${purchase.sessionId}
Wallet: ${wallet?.name}
Goal: ${cmd.prompt}

Searching marketplace and evaluating every candidate against your authority…`);

    const run=await runPurchaseSession(
      {
        DATABASE_URL:env.DATABASE_URL,
        APPROVAL_SIGNING_SECRET:env.APPROVAL_SIGNING_SECRET,
        COMMERCE_CATALOG_URL:env.COMMERCE_CATALOG_URL,
        SHOPIFY_STORE_DOMAIN:env.SHOPIFY_STORE_DOMAIN,
        SHOPIFY_STOREFRONT_PUBLIC_TOKEN:env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN,
        SHOPIFY_STOREFRONT_PRIVATE_TOKEN:env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
        SHOPIFY_STOREFRONT_API_VERSION:env.SHOPIFY_STOREFRONT_API_VERSION
      },
      purchase.sessionId
    );

    const lines=run.candidates.slice(0,6).map(candidateLine);

    if(run.session?.status==="READY_TO_PAY"){
      const payment=await createPaymentLinkForSession(
        {
          DATABASE_URL:env.DATABASE_URL,
          APPROVAL_SIGNING_SECRET:env.APPROVAL_SIGNING_SECRET,
          UPSTASH_REDIS_REST_URL:env.UPSTASH_REDIS_REST_URL,
          UPSTASH_REDIS_REST_TOKEN:env.UPSTASH_REDIS_REST_TOKEN,
          RAZORPAY_KEY_ID:env.RAZORPAY_KEY_ID,
          RAZORPAY_KEY_SECRET:env.RAZORPAY_KEY_SECRET,
          RAZORPAY_WEBHOOK_SECRET:env.RAZORPAY_WEBHOOK_SECRET,
          SHOPIFY_STORE_DOMAIN:env.SHOPIFY_STORE_DOMAIN,
          SHOPIFY_STOREFRONT_PUBLIC_TOKEN:env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN,
          SHOPIFY_STOREFRONT_PRIVATE_TOKEN:env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
          SHOPIFY_STOREFRONT_API_VERSION:env.SHOPIFY_STOREFRONT_API_VERSION,
          WAHA_BASE_URL:env.WAHA_BASE_URL,
          WAHA_API_KEY:env.WAHA_API_KEY
        },
        run.session.sessionId
      );

      await reply(env,input.chatId,input.wahaSession,
`🧠 *Agent evaluation*

${lines.join("\n")}

🎯 *Selected*
${run.session.selectedProduct?.title}
₹${run.session.selectedProduct?.price.toLocaleString("en-IN")}

💳 *Razorpay checkout ready*
${payment.paymentLink?.shortUrl}

IntentLock has not marked the purchase complete yet.
Completion happens only after the verified Razorpay webhook.

Session: ${run.session.sessionId}`);
      return;
    }

    if(run.session?.status==="AWAITING_STEP_UP"){
      const selected=run.session.selectedProduct;
      const selectedEval=run.candidates.find(c=>c.product.id===selected?.id);

      await reply(env,input.chatId,input.wahaSession,
`🧠 *Agent evaluation*

${lines.join("\n")}

⚠️ *STEP-UP REQUIRED*

${selected?.title}
₹${selected?.price.toLocaleString("en-IN")}

Additional authority required:
+₹${Number(selectedEval?.additionalAuthorityRequired??0).toLocaleString("en-IN")}

Reply:
*ALLOW ONCE*
*RAISE LIMIT*
or *REJECT*

Session: ${run.session.sessionId}`);
      return;
    }

    await reply(env,input.chatId,input.wahaSession,
`🚫 *No authorized candidate*

${lines.join("\n")}

IntentLock blocked autonomous purchase.
Money movement: ₹0

Session: ${run.session?.sessionId}`);
  }
}
