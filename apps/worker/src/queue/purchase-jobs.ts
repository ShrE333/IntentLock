import {
  runPurchaseSession
} from "../sessions/orchestrator";
import {verifyInteractiveJob,finishExecutionJob,retryExecutionJob} from '../access/jobs';
import {ACCESS_CONTEXT,whatsappPrincipal} from '../access/identity';
import {
  addEvent,
  getSession,
  updateSession
} from "../sessions/repository";
import {
  createPaymentLinkForSession,
  finalizePayPalCaptureJob,
  type SessionPaymentEnv,
  type PayPalSettlementJob
} from "../session-payments/service";
import {
  getWallet
} from "../wallets/repository";
import {
  sendWahaText
} from "../whatsapp/waha-client";

type InteractivePurchaseJob =
  | {
      kind:"RUN_PURCHASE";
      jobId?:string;
      sessionId:string;
      chatId:string;
      wahaSession:string;
    }
  | {
      kind:"CREATE_PAYMENT";
      jobId?:string;
      sessionId:string;
      chatId:string;
      wahaSession:string;
    };

export type PurchaseQueueJob = InteractivePurchaseJob | PayPalSettlementJob;

type Env=SessionPaymentEnv & {
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
  job:InteractivePurchaseJob,
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

export function paymentEnv<T extends SessionPaymentEnv>(env:T):T{return {...env};}
export function orchestrationEnv<T extends SessionPaymentEnv>(env:T):T{return {...env};}

async function ensurePayment(
  env:Env,
  job:InteractivePurchaseJob
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
`💳 *Provider checkout ready*

${session.paymentLinkUrl??"Checkout already created."}

IntentLock will mark the purchase complete only after the provider verified webhook.

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
`💳 *Provider checkout ready*

🎯 ${session.selectedProduct?.title??"Selected product"}
₹${Number(
  session.selectedProduct?.price??0
).toLocaleString("en-IN")}

${payment.paymentLink?.checkoutUrl}

IntentLock has *not* marked this purchase complete yet.
Completion happens only after the provider verified webhook.

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
    session.status==="CREATED"
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
Risk assessment: recorded in the session evidence.
Risk: *${"See session evidence"}*

💳 *Provider checkout ready*
${payment.paymentLink?.checkoutUrl}

IntentLock will mark the purchase CAPTURED only after a verified provider capture webhook.

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

    await reply(
      env,
      job,
`🧠 *Agent evaluation*

${lines.length
  ? lines.join("\n")
  : "Policy evaluation completed."}

🛡️ *Adaptive Agent Trust*
Risk assessment: recorded in the session evidence.
Risk: *${"See session evidence"}*

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
  job:InteractivePurchaseJob,
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
  job:InteractivePurchaseJob
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
    // Settlement errors must stay retryable; they must never enter the purchase
    // failure path or send a misleading "no money moved" WhatsApp notification.
    if(message.body.kind==="FINALIZE_PAYPAL_CAPTURE"){
      try{
        await finalizePayPalCaptureJob(env,message.body);
        message.ack();
      }catch{
        console.error("PAYPAL_WEBHOOK_PROCESSING_ERROR",{
          stage:"QUEUE_SETTLEMENT",payloadHash:message.body.payloadHash,attempts:message.attempts
        });
        message.retry({delaySeconds:Math.min(30,Math.max(2,message.attempts*3))});
      }
      continue;
    }
    try{
      if(!await verifyInteractiveJob(env.DATABASE_URL,message.body)){message.ack();continue;}
      await processJob(
        {...env,[ACCESS_CONTEXT]:{kind:'wa',principalId:await whatsappPrincipal(message.body.chatId),scopes:['financial:read','payment:execute','session:run']}},
        message.body
      );
      await finishExecutionJob(env.DATABASE_URL,message.body.jobId!);
      message.ack();
    }catch(error){
      if(error instanceof Error&&['EXECUTION_IDENTITY_REQUIRED','CHAT_ACCESS_REVOKED','RESOURCE_NOT_FOUND'].includes(error.message)){message.ack();continue;}
      if(error instanceof Error&&error.message==='EXECUTION_IDENTITY_INVALID_OR_BUSY'){message.retry({delaySeconds:30});continue;}
      if(message.body.jobId)await retryExecutionJob(env.DATABASE_URL,message.body.jobId);
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
