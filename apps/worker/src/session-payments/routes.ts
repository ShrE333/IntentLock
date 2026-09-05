import {getSession} from "../sessions/repository";
import {getVerifiedProofReceipt} from "./proof";
import {
  createPaymentLinkForSession,
  processSessionRazorpayWebhook,
  type SessionPaymentEnv
} from "./service";
import {getSessionPaymentLink} from "./repository";

const headers={
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type,x-razorpay-signature"
};

const json=(body:unknown,status=200)=>new Response(
  JSON.stringify(body),
  {status,headers}
);

export async function handleSessionPaymentRoutes(
  request:Request,
  env:SessionPaymentEnv,
  url:URL
):Promise<Response|null>{
  if(request.method==="OPTIONS" && (
    url.pathname.startsWith("/api/sessions/") ||
    url.pathname==="/webhooks/razorpay"
  )){
    return new Response(null,{status:204,headers});
  }

  if(request.method==="POST" && url.pathname==="/webhooks/razorpay"){
    try{
      return await processSessionRazorpayWebhook(env,request);
    }catch(error){
      return json({
        error:"SESSION_RAZORPAY_WEBHOOK_FAILED",
        message:error instanceof Error?error.message:String(error)
      },500);
    }
  }

  const paymentMatch=url.pathname.match(
    /^\/api\/sessions\/([^/]+)\/payment-link$/
  );

  if(paymentMatch && request.method==="POST"){
    try{
      const sessionId=decodeURIComponent(paymentMatch[1]);
      const result=await createPaymentLinkForSession(env,sessionId);
      return json({ok:true,...result});
    }catch(error){
      return json({
        error:"SESSION_PAYMENT_LINK_FAILED",
        message:error instanceof Error?error.message:String(error)
      },409);
    }
  }

  if(paymentMatch && request.method==="GET"){
    if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},500);
    const sessionId=decodeURIComponent(paymentMatch[1]);
    const paymentLink=await getSessionPaymentLink(env.DATABASE_URL,sessionId);
    return json({paymentLink});
  }

  const proofMatch=url.pathname.match(
    /^\/api\/sessions\/([^/]+)\/proof$/
  );

  if(proofMatch && request.method==="GET"){
    if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},500);

    const sessionId=decodeURIComponent(proofMatch[1]);
    const session=await getSession(env.DATABASE_URL,sessionId);

    if(!session) return json({error:"SESSION_NOT_FOUND"},404);

    const proof=await getVerifiedProofReceipt(
      env.DATABASE_URL,
      sessionId
    );

    if(!proof) return json({
      error:"PROOF_NOT_READY",
      sessionStatus:session.status
    },404);

    return json(proof);
  }

  return null;
}
