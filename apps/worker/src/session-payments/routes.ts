import {getSession} from "../sessions/repository";
import {getVerifiedProofReceipt} from "./proof";
import {
  authorizePayPalForSession,
  capturePayPalForSession,
  createPaymentForSession,
  processSessionPayPalWebhook,
  processSessionRazorpayWebhook,
  type SessionPaymentEnv
} from "./service";
import {getSessionPayment} from "./repository";
import {getWalletReservation} from './reservations';
import {recipientMappingConfigured} from '../payments/recipient-binding';
import {activePaymentProvider} from "./providers";
import {evaluatePaymentCapability,selectPaymentProvider} from "./providers/capabilities";

const headers={
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":[
    "content-type","x-razorpay-signature","paypal-auth-algo","paypal-cert-url",
    "paypal-transmission-id","paypal-transmission-sig","paypal-transmission-time"
  ].join(",")
};

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});

function withLegacyShape(payment:any){
  if(!payment) return null;
  return {
    ...payment,
    shortUrl:payment.checkoutUrl,
    providerLinkId:payment.providerOrderId,
    providerPaymentId:payment.providerCaptureId
  };
}

export async function handleSessionPaymentRoutes(
  request:Request,
  env:SessionPaymentEnv,
  url:URL
):Promise<Response|null>{
  if(request.method==="OPTIONS" && (
    url.pathname.startsWith("/api/sessions/") ||
    url.pathname==="/webhooks/razorpay" ||
    url.pathname==="/webhooks/paypal"
  )) return new Response(null,{status:204,headers});

  if(request.method==="POST" && url.pathname==="/webhooks/paypal"){
    try{return await processSessionPayPalWebhook(env,request);}
    catch(error){
      return json({
        error:"SESSION_PAYPAL_WEBHOOK_FAILED",
        message:error instanceof Error?error.message:String(error)
      },500);
    }
  }

  if(request.method==="POST" && url.pathname==="/webhooks/razorpay"){
    try{return await processSessionRazorpayWebhook(env,request);}
    catch(error){
      return json({
        error:"SESSION_RAZORPAY_WEBHOOK_FAILED",
        message:error instanceof Error?error.message:String(error)
      },500);
    }
  }

  if(request.method==="GET" && url.pathname==="/api/payments/provider"){
    return json({
      mode:String(env.PAYMENT_PROVIDER??"auto"),
      paypalEnvironment:String(env.PAYPAL_ENV??'sandbox').toLowerCase()==='live'?'live':'sandbox',
      legacyDefault:activePaymentProvider(env),
      selection:"PER_TRANSACTION_CAPABILITY",
      paypalConfigured:Boolean(env.PAYPAL_CLIENT_ID&&env.PAYPAL_CLIENT_SECRET&&env.PAYPAL_WEBHOOK_ID),
      recipientMappingConfigured:recipientMappingConfigured(env),
      razorpayConfigured:Boolean(env.RAZORPAY_KEY_ID&&env.RAZORPAY_KEY_SECRET)
    });
  }

  if(request.method==="GET" && url.pathname==="/api/payments/capabilities"){
    const context={
      amount:Number(url.searchParams.get("amount")??1),
      currency:String(url.searchParams.get("currency")??"USD").toUpperCase(),
      walletCurrency:String(url.searchParams.get("walletCurrency")??"INR").toUpperCase(),
      buyerCountry:String(url.searchParams.get("buyerCountry")??"IN").toUpperCase(),
      merchantCountry:String(url.searchParams.get("merchantCountry")??"ZZ").toUpperCase()
    };
    const evaluated=[
      evaluatePaymentCapability("paypal",env,context),
      evaluatePaymentCapability("razorpay",env,context)
    ];
    let selected:null|string=null;
    try{selected=selectPaymentProvider(env,context).provider;}catch{}
    return json({context,selected,evaluated});
  }

  const paymentMatch=url.pathname.match(
    /^\/api\/sessions\/([^/]+)\/(payment|payment-link)$/
  );

  if(paymentMatch && request.method==="POST"){
    try{
      const sessionId=decodeURIComponent(paymentMatch[1]);
      const result=await createPaymentForSession(env,sessionId);
      const payment=withLegacyShape(result.payment);
      return json({ok:true,duplicate:result.duplicate,payment,paymentLink:payment});
    }catch(error){
      return json({
        error:"SESSION_PAYMENT_FAILED",
        message:error instanceof Error?error.message:String(error)
      },409);
    }
  }

  if(paymentMatch && request.method==="GET"){
    if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},500);
    const sessionId=decodeURIComponent(paymentMatch[1]);
    const payment=withLegacyShape(await getSessionPayment(env.DATABASE_URL,sessionId));
    const reservation=await getWalletReservation(env.DATABASE_URL,sessionId);
    return json({payment,paymentLink:payment,reservation});
  }

  const authorizeMatch=url.pathname.match(
    /^\/api\/sessions\/([^/]+)\/payment\/authorize$/
  );
  if(authorizeMatch && request.method==="POST"){
    try{
      const sessionId=decodeURIComponent(authorizeMatch[1]);
      return json({ok:true,...await authorizePayPalForSession(env,sessionId)});
    }catch(error){
      return json({
        error:"PAYPAL_AUTHORIZE_FAILED",
        message:error instanceof Error?error.message:String(error)
      },409);
    }
  }

  const captureMatch=url.pathname.match(
    /^\/api\/sessions\/([^/]+)\/payment\/capture$/
  );
  if(captureMatch && request.method==="POST"){
    try{
      const sessionId=decodeURIComponent(captureMatch[1]);
      return json({ok:true,...await capturePayPalForSession(env,sessionId)});
    }catch(error){
      return json({
        error:"PAYPAL_CAPTURE_FAILED",
        message:error instanceof Error?error.message:String(error)
      },409);
    }
  }

  const proofMatch=url.pathname.match(/^\/api\/sessions\/([^/]+)\/proof$/);
  if(proofMatch && request.method==="GET"){
    if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},500);
    const sessionId=decodeURIComponent(proofMatch[1]);
    const session=await getSession(env.DATABASE_URL,sessionId);
    if(!session) return json({error:"SESSION_NOT_FOUND"},404);
    const proof=await getVerifiedProofReceipt(env.DATABASE_URL,sessionId,env.APPROVAL_SIGNING_SECRET);
    if(!proof) return json({error:"PROOF_NOT_READY",sessionStatus:session.status},404);
    return json(proof);
  }

  return null;
}
