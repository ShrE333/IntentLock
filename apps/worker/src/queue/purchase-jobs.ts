import {
  runPurchaseSession
} from "../sessions/orchestrator";
import {
  addEvent,
  getSession,
  updateSession
} from "../sessions/repository";
import {
  createPaymentLinkForSession
} from "../session-payments/service";
import {
  assessSessionRisk
} from "../risk/service";
import {
  getWallet
} from "../wallets/repository";
import {
  issueStepUpRequest
} from "../wallets/stepup";
import {
  sendWahaText
} from "../whatsapp/waha-client";

export type PurchaseQueueJob =
  | {
      kind:"RUN_PURCHASE";
      sessionId:string;
      chatId:string;
      wahaSession:string;
    }
  | {
      kind:"CREATE_PAYMENT";
      sessionId:string;
      chatId:string;
      wahaSession:string;
    };

type Env={
  DATABASE_URL:string;
  APPROVAL_SIGNING_SECRET?:string;

  COMMERCE_CATALOG_URL?:string;
  SHOPIFY_STORE_DOMAIN?:string;
  SHOPIFY_STOREFRONT_PUBLIC_TOKEN?:string;
  SHOPIFY_STOREFRONT_PRIVATE_TOKEN?:string;
  SHOPIFY_STOREFRONT_API_VERSION?:string;

  UPSTASH_REDIS_REST_URL?:string;
  UPSTASH_REDIS_REST_TOKEN?:string;

  RAZORPAY_KEY_ID?:string;
  RAZORPAY_KEY_SECRET?:string;
  RAZORPAY_WEBHOOK_SECRET?:string;

  WAHA_BASE_URL:string;
  WAHA_API_KEY:string;
};

type QueueMessageLike={
  body:PurchaseQueueJob;
  attempts:number;
  ack():void;
  retry(options?:{delaySeconds?:number}):void;
};

type QueueBatchLike={
  messages:readonly QueueMessageLike[];
};

async function reply(
  env:Env,
  job:PurchaseQueueJob,
  text:string
){
  await sendWahaText({
    baseUrl:env.WAHA_BASE_URL,
    apiKey:env.WAHA_API_KEY,
    session:job.wahaSession,
    chatId:job.chatId,
    text
  });
}

function candidateLine(c:any){
  const p=c.product;

  const icon=
    c.decision==="ALLOW"
      ?"✅"
      :c.decision==="STEP_UP"
        ?"⚠️"
        :"❌";

  const detail=
    c.decision==="BLOCK"
      ? c.violations.join(", ")
      : c.decision==="STEP_UP"
        ? `+₹${Number(
            c.additionalAuthorityRequired
          ).toLocaleString("en-IN")} approval`
        : "autonomous";

  return `${icon} ${p.brand} · ₹${Number(
    p.price
  ).toLocaleString("en-IN")} · ${detail}`;
}

function paymentEnv(env:Env){
  return {
    DATABASE_URL:env.DATABASE_URL,
    APPROVAL_SIGNING_SECRET:
      env.APPROVAL_SIGNING_SECRET,

    UPSTASH_REDIS_REST_URL:
      env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN:
      env.UPSTASH_REDIS_REST_TOKEN,

    RAZORPAY_KEY_ID:env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET:
      env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET:
      env.RAZORPAY_WEBHOOK_SECRET,

    COMMERCE_CATALOG_URL:
      env.COMMERCE_CATALOG_URL,

    SHOPIFY_STORE_DOMAIN:
      env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_STOREFRONT_PUBLIC_TOKEN:
      env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN,
    SHOPIFY_STOREFRONT_PRIVATE_TOKEN:
      env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
    SHOPIFY_STOREFRONT_API_VERSION:
      env.SHOPIFY_STOREFRONT_API_VERSION,

    WAHA_BASE_URL:env.WAHA_BASE_URL,
    WAHA_API_KEY:env.WAHA_API_KEY
  };
}

function orchestrationEnv(env:Env){
  return {
    DATABASE_URL:env.DATABASE_URL,
    APPROVAL_SIGNING_SECRET:
      env.APPROVAL_SIGNING_SECRET,
    COMMERCE_CATALOG_URL:
      env.COMMERCE_CATALOG_URL,
    SHOPIFY_STORE_DOMAIN:
      env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_STOREFRONT_PUBLIC_TOKEN:
      env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN,
    SHOPIFY_STOREFRONT_PRIVATE_TOKEN:
      env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
    SHOPIFY_STOREFRONT_API_VERSION:
      env.SHOPIFY_STOREFRONT_API_VERSION
  };
}


async function assessCurrentRisk(
  env:Env,
  session:any,
  candidates:any[]
){
  const selected=session.selectedProduct;
  if(!selected) return null;

  const searchMerchantMessages=candidates
    .map(candidate=>candidate?.product?.merchantMessage)
    .filter(
      (value):value is string=>
        typeof value==="string" &&
        value.trim().length>0
    );

  const assessment=await assessSessionRisk(
    env.DATABASE_URL,
    {
      sessionId:session.sessionId,
      walletId:session.walletId,
      agentId:"intentlock-purchase-agent",
      merchant:selected.merchant??null,
      amount:Number(selected.price),
      currency:String(selected.currency??"INR"),
      policyDecision:
        session.selectedDecision??"ALLOW",
      selectedMerchantMessage:
        selected.merchantMessage??null,
      searchMerchantMessages
    },
    {
      reuseExisting:true
    }
  );

  await addEvent(
    env.DATABASE_URL,
    session.sessionId,
    "AGENT_RISK_ASSESSED",
    {
      assessmentId:assessment.assessmentId,
      trustScore:assessment.trustScore,
      riskLevel:assessment.riskLevel,
      riskAction:assessment.riskAction,
      policyDecision:
        assessment.policyDecision,
      signals:assessment.signals.map(
        signal=>({
          code:signal.code,
          severity:signal.severity,
          delta:signal.delta
        })
      ),
      invariant:
        "RISK_CANNOT_EXPAND_WALLET_AUTHORITY"
    }
  );

  return assessment;
}

async function applyHighRiskStepUp(
  env:Env,
  session:any,
  assessment:any
){
  if(
    assessment.riskAction!=="STEP_UP" ||
    session.selectedDecision!=="ALLOW" ||
    !session.selectedProduct
  ){
    return null;
  }

  const wallet=await getWallet(
    env.DATABASE_URL,
    session.walletId
  );

  if(!wallet)
    throw new Error("WALLET_NOT_FOUND");

  const product=session.selectedProduct;

  const transaction={
    productName:product.title,
    category:product.category,
    brand:product.brand,
    amount:Number(product.price),
    currency:String(product.currency??"INR"),
    quantity:1,
    features:Array.isArray(product.features)
      ?product.features.map(String)
      :[]
  };

  const stepUp=await issueStepUpRequest(
    env.DATABASE_URL,
    wallet,
    transaction,
    {
      decision:"STEP_UP",
      violations:[],
      reasons:[
        "Adaptive Agent Trust & Risk Engine requires explicit approval."
      ],
      remainingAuthority:Math.max(
        0,
        Number(wallet.totalAuthority)-
        Number(wallet.spentAmount)
      ),
      requestedAmount:Number(product.price),
      additionalAuthorityRequired:0,
      canAutoExecute:false,
      requiresHumanApproval:true
    }
  );

  if(!stepUp)
    throw new Error(
      "RISK_STEP_UP_CREATION_FAILED"
    );

  const updated=await updateSession(
    env.DATABASE_URL,
    session.sessionId,
    {
      status:"AWAITING_STEP_UP",
      selectedDecision:"STEP_UP",
      stepUpRequestId:stepUp.requestId
    }
  );

  await addEvent(
    env.DATABASE_URL,
    session.sessionId,
    "RISK_STEP_UP_REQUIRED",
    {
      assessmentId:assessment.assessmentId,
      trustScore:assessment.trustScore,
      riskLevel:assessment.riskLevel,
      requestId:stepUp.requestId,
      additionalAuthorityRequired:0,
      reason:
        "HIGH_RISK_REQUIRES_EXPLICIT_HUMAN_APPROVAL"
    }
  );

  return {
    session:updated,
    stepUp
  };
}

async function ensurePayment(
  env:Env,
  job:PurchaseQueueJob
){
  const session=await getSession(
    env.DATABASE_URL,
    job.sessionId
  );

  if(!session)
    throw new Error("SESSION_NOT_FOUND");

  if(session.status==="PAYMENT_PENDING"){
    await reply(
      env,
      job,
`💳 *Razorpay checkout ready*

${session.paymentLinkUrl??"Checkout already created."}

IntentLock will mark the purchase complete only after Razorpay's verified webhook.

Session: ${session.sessionId}`
    );
    return;
  }

  if(session.status==="CAPTURED"){
    await reply(
      env,
      job,
`✅ *Purchase already captured*

Session: ${session.sessionId}
Proof Receipt: ${session.proofReceiptId??"generated after verified payment"}`
    );
    return;
  }

  if(session.status!=="READY_TO_PAY"){
    throw new Error(
      `SESSION_NOT_READY_TO_PAY:${session.status}`
    );
  }

  const payment=await createPaymentLinkForSession(
    paymentEnv(env),
    session.sessionId
  );

  await reply(
    env,
    job,
`💳 *Razorpay checkout ready*

🎯 ${session.selectedProduct?.title??"Selected product"}
₹${Number(
  session.selectedProduct?.price??0
).toLocaleString("en-IN")}

${payment.paymentLink?.shortUrl}

IntentLock has *not* marked this purchase complete yet.
Completion happens only after Razorpay's verified webhook.

Session: ${session.sessionId}`
  );
}

async function runPurchase(
  env:Env,
  job:Extract<
    PurchaseQueueJob,
    {kind:"RUN_PURCHASE"}
  >
){
  let session=await getSession(
    env.DATABASE_URL,
    job.sessionId
  );

  if(!session)
    throw new Error("SESSION_NOT_FOUND");

  let run:
    |Awaited<ReturnType<typeof runPurchaseSession>>
    |null=null;

  if(
    session.status==="CREATED" ||
    session.status==="SEARCHING"
  ){
    run=await runPurchaseSession(
      orchestrationEnv(env),
      job.sessionId
    );

    if(!run.session)
      throw new Error(
        "SESSION_MISSING_AFTER_ORCHESTRATION"
      );

    session=run.session;
  }

  if(session.status==="READY_TO_PAY"){
    const lines=(run?.candidates??[])
      .slice(0,6)
      .map(candidateLine);

    const assessment=await assessCurrentRisk(
      env,
      session,
      run?.candidates??[]
    );

    if(
      assessment &&
      assessment.riskAction==="STEP_UP" &&
      session.selectedDecision==="ALLOW"
    ){
      const escalated=
        await applyHighRiskStepUp(
          env,
          session,
          assessment
        );

      await reply(
        env,
        job,
`🧠 *Agent evaluation*

${lines.length
  ? lines.join("\n")
  : "Policy evaluation completed."}

🎯 *Selected*
${session.selectedProduct?.title}
₹${session.selectedProduct?.price.toLocaleString("en-IN")}

🛡️ *Adaptive Agent Trust*
Trust score: *${assessment.trustScore}/100*
Risk: *${assessment.riskLevel}*

⚠️ *RISK STEP-UP REQUIRED*

The Intent Wallet policy allowed this transaction, but behavioral risk requires explicit human approval.

No additional spending authority is being requested.

Reply:
*ALLOW ONCE*
or *REJECT*

Session: ${escalated?.session?.sessionId??session.sessionId}`
      );

      return;
    }

    const payment=await createPaymentLinkForSession(
      paymentEnv(env),
      session.sessionId
    );

    await reply(
      env,
      job,
`🧠 *Agent evaluation*

${lines.length
  ? lines.join("\n")
  : "Policy evaluation completed."}

🎯 *Selected*
${session.selectedProduct?.title}
₹${session.selectedProduct?.price.toLocaleString("en-IN")}

🛡️ *Adaptive Agent Trust*
Trust score: *${assessment?.trustScore??"—"}/100*
Risk: *${assessment?.riskLevel??"UNKNOWN"}*

💳 *Razorpay checkout ready*
${payment.paymentLink?.shortUrl}

IntentLock will mark the purchase CAPTURED only after the verified Razorpay webhook.

Session: ${session.sessionId}`
    );

    return;
  }

  if(session.status==="AWAITING_STEP_UP"){
    const selected=session.selectedProduct;

    const selectedEval=run?.candidates.find(
      c=>c.product.id===selected?.id
    );

    const lines=(run?.candidates??[])
      .slice(0,6)
      .map(candidateLine);

    const assessment=
      selected
        ?await assessCurrentRisk(
          env,
          session,
          run?.candidates??[]
        )
        :null;

    await reply(
      env,
      job,
`🧠 *Agent evaluation*

${lines.length
  ? lines.join("\n")
  : "Policy evaluation completed."}

🛡️ *Adaptive Agent Trust*
Trust score: *${assessment?.trustScore??"—"}/100*
Risk: *${assessment?.riskLevel??"UNKNOWN"}*

⚠️ *STEP-UP REQUIRED*

${selected?.title}
₹${selected?.price.toLocaleString("en-IN")}

Additional authority required:
+₹${Number(
  selectedEval?.additionalAuthorityRequired??0
).toLocaleString("en-IN")}

Reply:
*ALLOW ONCE*
*RAISE LIMIT*
or *REJECT*

Session: ${session.sessionId}`
    );

    return;
  }

  if(session.status==="BLOCKED"){
    const lines=(run?.candidates??[])
      .slice(0,6)
      .map(candidateLine);

    await reply(
      env,
      job,
`🚫 *No authorized candidate*

${lines.length
  ? lines.join("\n")
  : "Every evaluated candidate was outside delegated authority."}

IntentLock blocked autonomous purchase.
Money movement: ₹0

Session: ${session.sessionId}`
    );

    return;
  }

  if(session.status==="PAYMENT_PENDING"){
    await ensurePayment(env,job);
    return;
  }

  if(session.status==="CAPTURED"){
    await ensurePayment(env,job);
    return;
  }

  throw new Error(
    `UNEXPECTED_PURCHASE_SESSION_STATE:${session.status}`
  );
}

export function isNonRetryable(error:unknown){
  const message=
    error instanceof Error
      ?error.message
      :String(error);

  return [
    "SESSION_NOT_FOUND",
    "WALLET_NOT_FOUND",
    "WALLET_EXPIRED",
    "COMMERCE_PRODUCT_NO_LONGER_AVAILABLE",
    "COMMERCE_PRODUCT_OUT_OF_STOCK",
    "COMMERCE_QUOTE_CHANGED_REAUTHORIZE",
    "AUTHORITY_CHANGED",
    "ONE_TIME_AUTHORIZATION_REQUIRED",
    "AUTHORIZATION_EXPIRED",
    "AUTHORIZATION_ALREADY_CONSUMED"
  ].some(code=>message.includes(code));
}

async function notifyTerminalFailure(
  env:Env,
  job:PurchaseQueueJob,
  error:unknown
){
  const message=
    error instanceof Error
      ?error.message
      :String(error);

  let userText=
`⚠️ *IntentLock could not continue this purchase*

Session: ${job.sessionId}

Reason: ${message}`;

  if(message.includes(
    "COMMERCE_QUOTE_CHANGED_REAUTHORIZE"
  )){
    userText=
`⚠️ *Shopify quote changed*

IntentLock stopped payment because the live product facts changed after authorization.

No money moved.

Please send your purchase request again so the new quote can be authorized.

Session: ${job.sessionId}`;
  }

  try{
    await reply(env,job,userText);
  }catch(error){
    console.error(
      "Failed to notify WhatsApp about terminal queue error",
      error
    );
  }
}

async function processJob(
  env:Env,
  job:PurchaseQueueJob
){
  if(job.kind==="RUN_PURCHASE"){
    await runPurchase(env,job);
    return;
  }

  if(job.kind==="CREATE_PAYMENT"){
    await ensurePayment(env,job);
    return;
  }

  throw new Error("UNKNOWN_PURCHASE_QUEUE_JOB");
}

/**
 * Queue consumer.
 *
 * IMPORTANT: configure max_batch_size = 1.
 * Every queued purchase therefore receives a fresh Cloudflare Worker
 * invocation and its own 50-external-subrequest budget on Workers Free.
 */
export async function handlePurchaseQueue(
  batch:QueueBatchLike,
  env:Env,
  _ctx:unknown
){
  for(const message of batch.messages){
    try{
      await processJob(
        env,
        message.body
      );

      message.ack();
    }catch(error){
      console.error(
        "IntentLock purchase queue job failed",
        {
          job:message.body,
          attempts:message.attempts,
          error
        }
      );

      if(
        isNonRetryable(error) ||
        message.attempts>=5
      ){
        await notifyTerminalFailure(
          env,
          message.body,
          error
        );

        message.ack();
        continue;
      }

      message.retry({
        delaySeconds:Math.min(
          30,
          Math.max(2,message.attempts*3)
        )
      });
    }
  }
}
