import {neon} from "@neondatabase/serverless";
import {listSessions,getSession,getEvents} from "../sessions/repository";
import {getWallet} from "../wallets/repository";
import {
  getSessionPayment,
  getWalletLedgerForSession,
  getProofReceipt
} from "../session-payments/repository";
import {getVerifiedProofReceipt} from "../session-payments/proof";
import {finalizePayPalCaptureJob,type SessionPaymentEnv} from "../session-payments/service";
import {getPayPalCaptureDetails} from "../session-payments/providers/paypal";
import {publicPayeeLockConfig,type PayeeLockEnv} from "../commerce/payee-lock";
import {sha256Hex} from "../wallets/crypto";
import type {PurchaseSession} from "../sessions/types";
import {
  evaluateSessionRefund,requestSessionRefund,syncSessionRefund,getSessionPostPurchaseState,
  getSessionPayPalDisputes,getPayPalDispute,sendDisputeEvidenceSummary
} from "../post-purchase/service";

export type TrustCenterEnv=SessionPaymentEnv & PayeeLockEnv & {
  DATABASE_URL?:string;
  TRUSTOPS_ADMIN_TOKEN?:string;
};

const headers={
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type,x-intentlock-ops-token"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body,null,2),{status,headers});
const ageMs=(iso:string)=>Math.max(0,Date.now()-new Date(iso).getTime());

export type ReconciliationFinding={
  sessionId:string;
  status:"HEALTHY"|"DRIFT"|"PENDING"|"STALE_PENDING"|"CLOSED"|"NO_PAYMENT";
  severity:"OK"|"INFO"|"WARNING"|"CRITICAL";
  sessionStatus:string;
  paymentStatus:string|null;
  provider:string|null;
  providerCaptureId:string|null;
  ledgerPresent:boolean;
  proofPresent:boolean;
  providerSnapshot:null|{status:string;amount:number;currency:string};
  issues:string[];
  pendingReason:string|null;
  nextStep:string;
  recommendedAction:"NONE"|"WAIT_FOR_WEBHOOK"|"REPLAY_VERIFIED_EVIDENCE"|"INVESTIGATE";
  updatedAt:string;
};

async function inspectSession(env:TrustCenterEnv,session:PurchaseSession,deep=false):Promise<ReconciliationFinding>{
  const db=String(env.DATABASE_URL);
  const [payment,ledger,proof]=await Promise.all([
    getSessionPayment(db,session.sessionId),
    getWalletLedgerForSession(db,session.sessionId),
    getProofReceipt(db,session.sessionId)
  ]);

  let providerSnapshot:ReconciliationFinding["providerSnapshot"]=null;
  if(deep&&payment?.provider==="paypal"&&payment.providerCaptureId&&env.PAYPAL_CLIENT_ID&&env.PAYPAL_CLIENT_SECRET){
    try{
      const p=await getPayPalCaptureDetails(env,payment.providerCaptureId);
      providerSnapshot={status:p.status,amount:p.amount,currency:p.currency};
    }catch{
      providerSnapshot=null;
    }
  }

  const issues:string[]=[];
  const captured=session.status==="CAPTURED";
  const paymentCompleted=payment?.status==="COMPLETED";

  if(captured&&!paymentCompleted) issues.push("SESSION_CAPTURED_PAYMENT_NOT_COMPLETED");
  if(captured&&!ledger) issues.push("CAPTURED_WITHOUT_WALLET_LEDGER");
  if(captured&&!proof) issues.push("CAPTURED_WITHOUT_PROOF_RECEIPT");
  if(paymentCompleted&&!captured) issues.push("PAYMENT_COMPLETED_SESSION_NOT_CAPTURED");
  if(paymentCompleted&&!ledger) issues.push("PAYMENT_COMPLETED_LEDGER_MISSING");
  if(providerSnapshot?.status==="COMPLETED"&&!captured) issues.push("PROVIDER_COMPLETED_INTERNAL_NOT_CAPTURED");
  if(providerSnapshot?.status==="COMPLETED"&&payment&&(
    Math.abs(providerSnapshot.amount-payment.amount)>0.0001||
    providerSnapshot.currency!==payment.currency.toUpperCase()
  )) issues.push("PROVIDER_AMOUNT_OR_CURRENCY_MISMATCH");

  const pending=["PAYMENT_PENDING","PAYPAL_APPROVAL_PENDING","AUTHORIZED","CAPTURE_PENDING"].includes(session.status);
  const stale=pending&&ageMs(session.updatedAt)>10*60*1000;

  let pendingReason:string|null=null;
  let nextStep="No operator action required.";
  if(session.status==="READY_TO_PAY"){pendingReason="CHECKOUT_NOT_CREATED";nextStep="Create the authorized checkout from New Purchase.";}
  else if(session.status==="PAYPAL_APPROVAL_PENDING"){pendingReason="BUYER_APPROVAL_REQUIRED";nextStep="Resume PayPal approval from New Purchase. No capture has occurred yet.";}
  else if(session.status==="AUTHORIZED"){pendingReason="CAPTURE_REQUEST_NOT_FINISHED";nextStep="Resume the idempotent capture request from New Purchase.";}
  else if(session.status==="CAPTURE_PENDING"){pendingReason="VERIFIED_WEBHOOK_PENDING";nextStep="Wait for verified PayPal evidence. If stale, run a deep provider scan before reconciliation.";}
  else if(session.status==="PAYMENT_PENDING"){pendingReason="PROVIDER_WEBHOOK_PENDING";nextStep="Wait for the selected payment rail's verified webhook.";}
  else if(session.status==="BLOCKED"){nextStep="Inspect candidate policy reasons. BLOCKED is a policy outcome, not a payment failure.";}

  let status:ReconciliationFinding["status"];
  let severity:ReconciliationFinding["severity"];
  let recommendedAction:ReconciliationFinding["recommendedAction"]="NONE";

  if(issues.length){
    status="DRIFT";severity="CRITICAL";
    recommendedAction=payment?.provider==="paypal"&&payment.providerCaptureId
      ?"REPLAY_VERIFIED_EVIDENCE":"INVESTIGATE";
  }else if(captured&&paymentCompleted&&ledger&&proof){
    status="HEALTHY";severity="OK";
  }else if(stale){
    status="STALE_PENDING";severity="WARNING";
    recommendedAction=session.status==="CAPTURE_PENDING"?"REPLAY_VERIFIED_EVIDENCE":"INVESTIGATE";
  }else if(pending){
    status="PENDING";severity="INFO";recommendedAction="WAIT_FOR_WEBHOOK";
  }else if(["FAILED","CANCELLED","REJECTED","BLOCKED"].includes(session.status)){
    status="CLOSED";severity="INFO";
  }else if(!payment){
    status="NO_PAYMENT";severity="INFO";
  }else{
    status="PENDING";severity="INFO";
  }

  return {
    sessionId:session.sessionId,status,severity,sessionStatus:session.status,
    paymentStatus:payment?.status??null,provider:payment?.provider??null,
    providerCaptureId:payment?.providerCaptureId??null,
    ledgerPresent:Boolean(ledger),proofPresent:Boolean(proof),providerSnapshot,
    issues,pendingReason,nextStep,recommendedAction,updatedAt:session.updatedAt
  };
}

async function reconciliationScan(env:TrustCenterEnv,deep=false){
  const sessions=await listSessions(String(env.DATABASE_URL));
  const findings:ReconciliationFinding[]=[];
  for(let i=0;i<sessions.length;i++){
    // Provider reads are deliberately bounded so the dashboard cannot fan out into
    // dozens of PayPal calls in one request.
    findings.push(await inspectSession(env,sessions[i],deep&&i<8));
  }
  const counts={
    healthy:findings.filter(x=>x.status==="HEALTHY").length,
    drift:findings.filter(x=>x.status==="DRIFT").length,
    stale:findings.filter(x=>x.status==="STALE_PENDING").length,
    pending:findings.filter(x=>x.status==="PENDING").length,
    closed:findings.filter(x=>x.status==="CLOSED").length
  };
  return {generatedAt:new Date().toISOString(),deepProviderCheck:deep,counts,findings};
}

async function latestVerifiedPayPalEvidence(db:string,sessionId:string){
  const rows=await neon(db)`
    SELECT payload_hash,event_type,provider_payment_id
    FROM session_payment_webhook_events
    WHERE session_id=${sessionId}
      AND provider='paypal'
      AND event_type='PAYMENT.CAPTURE.COMPLETED'
    ORDER BY id DESC
    LIMIT 1
  `;
  if(!rows.length) return null;
  return {
    payloadHash:String(rows[0].payload_hash),
    eventType:String(rows[0].event_type),
    providerPaymentId:rows[0].provider_payment_id?String(rows[0].provider_payment_id):null
  };
}

type DisputeReason="UNAUTHORIZED_TRANSACTION"|"ITEM_NOT_RECEIVED"|"NOT_AS_DESCRIBED"|"DUPLICATE_CHARGE";
const disputeReason=(value:string|null):DisputeReason=>{
  const v=String(value??"").toUpperCase();
  return ["UNAUTHORIZED_TRANSACTION","ITEM_NOT_RECEIVED","NOT_AS_DESCRIBED","DUPLICATE_CHARGE"].includes(v)
    ?v as DisputeReason:"UNAUTHORIZED_TRANSACTION";
};

function requirement(label:string,available:boolean,evidence:string|null){
  return {label,available,evidence};
}

export async function buildDisputeEvidence(env:TrustCenterEnv,sessionId:string,reason:DisputeReason){
  const db=String(env.DATABASE_URL);
  const [session,events,payment,ledger,verifiedProof,wallet]=await Promise.all([
    getSession(db,sessionId),
    getEvents(db,sessionId),
    getSessionPayment(db,sessionId),
    getWalletLedgerForSession(db,sessionId),
    getVerifiedProofReceipt(db,sessionId),
    (async()=>{const s=await getSession(db,sessionId);return s?getWallet(db,s.walletId):null;})()
  ]);
  if(!session) throw new Error("SESSION_NOT_FOUND");

  const eventTypes=new Set(events.map(e=>e.eventType));
  const product=session.selectedProduct;
  const payee=product?.authorizationContext?.payeeLock??null;
  const common=[
    requirement("Original user/agent intent",Boolean(session.userPrompt),session.userPrompt||null),
    requirement("Deterministic policy decision",Boolean(session.selectedDecision),session.selectedDecision),
    requirement("Exact product and merchant",Boolean(product),product?`${product.title} · ${product.merchant}`:null),
    requirement("Payee identity binding",Boolean(payee),payee?.fingerprint??null),
    requirement("Provider order identity",Boolean(payment?.providerOrderId),payment?.providerOrderId??null),
    requirement("Provider capture identity",Boolean(payment?.providerCaptureId),payment?.providerCaptureId??null),
    requirement("Verified webhook evidence",eventTypes.has("PAYPAL_WEBHOOK_VERIFIED")||eventTypes.has("RAZORPAY_WEBHOOK_VERIFIED"),null),
    requirement("Replay-safe wallet ledger",Boolean(ledger),ledger?String((ledger as any).ledger_id):null),
    requirement("Cryptographic proof receipt",Boolean(verifiedProof?.receipt?.proofSignature),verifiedProof?.receipt?.receiptId??null),
    requirement("Valid audit chain",Boolean(verifiedProof?.verification.auditChainValid),verifiedProof?.verification.currentAuditHeadHash??null)
  ];

  const reasonSpecific:ReturnType<typeof requirement>[]=[];
  if(reason==="ITEM_NOT_RECEIVED")
    reasonSpecific.push(requirement("Fulfillment / delivery evidence",false,null));
  if(reason==="NOT_AS_DESCRIBED")
    reasonSpecific.push(requirement("Bound product features",Boolean(product?.features?.length),product?.features?.join(", ")??null));
  if(reason==="DUPLICATE_CHARGE")
    reasonSpecific.push(requirement("Idempotency key",Boolean(payment?.idempotencyKey),payment?.idempotencyKey??null));

  const requirements=[...common,...reasonSpecific];
  const available=requirements.filter(x=>x.available).length;
  const completeness=Math.round((available/requirements.length)*100);

  const packetCore={
    version:"intentlock-dispute-evidence-v1",
    generatedAt:new Date().toISOString(),
    reason,
    session:{
      sessionId:session.sessionId,status:session.status,channel:session.channel,
      userPrompt:session.userPrompt,createdAt:session.createdAt,completedAt:session.completedAt
    },
    wallet:wallet?{
      walletId:wallet.walletId,name:wallet.name,currency:wallet.currency,
      totalAuthority:wallet.totalAuthority,autoBuyLimit:wallet.autoBuyLimit,
      maxSingleTransaction:wallet.maxSingleTransaction,validUntil:wallet.validUntil
    }:null,
    authorization:{
      decision:session.selectedDecision,authorizationId:session.authorizationId,
      quoteHash:session.quoteHash,payeeLock:payee
    },
    product:product?{
      id:product.id,title:product.title,brand:product.brand,category:product.category,
      merchant:product.merchant,merchantCountry:product.merchantCountry,
      price:product.price,currency:product.currency,features:product.features,source:product.source??null
    }:null,
    payment:payment?{
      provider:payment.provider,providerOrderId:payment.providerOrderId,
      providerAuthorizationId:payment.providerAuthorizationId,
      providerCaptureId:payment.providerCaptureId,amount:payment.amount,currency:payment.currency,
      status:payment.status,capturedAt:payment.capturedAt,idempotencyKey:payment.idempotencyKey
    }:null,
    walletLedger:ledger?{
      ledgerId:String((ledger as any).ledger_id),amount:Number((ledger as any).amount),
      currency:String((ledger as any).currency),provider:String((ledger as any).provider),
      appliedAt:new Date(String((ledger as any).applied_at)).toISOString()
    }:null,
    proof:verifiedProof?{
      receiptId:verifiedProof.receipt.receiptId,proofHash:verifiedProof.receipt.proofHash,
      proofSignature:verifiedProof.receipt.proofSignature,
      auditChainValid:verifiedProof.verification.auditChainValid,
      checkedEvents:verifiedProof.verification.checkedEvents
    }:null,
    evidenceCoverage:{available,total:requirements.length,completeness,requirements},
    eventTimeline:events.map(e=>({eventSeq:e.eventSeq,eventType:e.eventType,occurredAt:e.occurredAt}))
  };
  const packetHash=await sha256Hex(JSON.stringify(packetCore));
  return {
    ...packetCore,
    packetHash,
    submissionReadiness:completeness===100?"READY":"NEEDS_ADDITIONAL_EVIDENCE",
    note:"This packet is generated from IntentLock evidence. It does not automatically concede or decide a dispute."
  };
}

async function validOpsRequest(request:Request,env:TrustCenterEnv){
  if(!env.TRUSTOPS_ADMIN_TOKEN) return false;
  const supplied=request.headers.get("x-intentlock-ops-token");
  if(!supplied) return false;
  const [actual,expected]=await Promise.all([sha256Hex(supplied),sha256Hex(env.TRUSTOPS_ADMIN_TOKEN)]);
  return actual===expected;
}

export async function handleTrustCenterRoutes(
  request:Request,
  env:TrustCenterEnv,
  url:URL
):Promise<Response|null>{
  if(!url.pathname.startsWith("/api/trust-center")) return null;
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers});
  if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},500);

  try{
    if(request.method==="GET"&&url.pathname==="/api/trust-center/overview"){
      const scan=await reconciliationScan(env,false);
      const sessions=await listSessions(env.DATABASE_URL);
      const recentPayees=sessions
        .map(s=>s.selectedProduct?.authorizationContext?.payeeLock)
        .filter(Boolean)
        .slice(0,6);
      return json({
        version:"v11.4.1",
        product:"IntentLock TrustOps",
        features:{disputeDefense:true,reconciliationWatchdog:true,payeeLock:true,refundFirewall:true,paypalDisputes:true},
        reconciliation:scan.counts,
        payeeLock:publicPayeeLockConfig(env),
        recentPayees,
        latestCapturedSessionId:sessions.find(s=>s.status==="CAPTURED")?.sessionId??null
      });
    }

    if(request.method==="GET"&&url.pathname==="/api/trust-center/reconciliation"){
      return json(await reconciliationScan(env,url.searchParams.get("deep")==="1"));
    }

    const reconcile=url.pathname.match(/^\/api\/trust-center\/reconciliation\/([^/]+)\/reconcile$/);
    if(request.method==="POST"&&reconcile){
      if(!env.TRUSTOPS_ADMIN_TOKEN) return json({error:"RECONCILIATION_ACTIONS_DISABLED"},503);
      const supplied=request.headers.get("x-intentlock-ops-token");
      if(!supplied) return json({error:"UNAUTHORIZED"},401);
      const [actual,expected]=await Promise.all([sha256Hex(supplied),sha256Hex(env.TRUSTOPS_ADMIN_TOKEN)]);
      if(actual!==expected) return json({error:"UNAUTHORIZED"},401);
      const sessionId=decodeURIComponent(reconcile[1]);
      const session=await getSession(env.DATABASE_URL,sessionId);
      if(!session) return json({error:"SESSION_NOT_FOUND"},404);
      const payment=await getSessionPayment(env.DATABASE_URL,sessionId);
      if(!payment) return json({error:"SESSION_PAYMENT_NOT_FOUND"},404);
      if(payment.provider!=="paypal")
        return json({error:"AUTO_RECONCILIATION_REQUIRES_PAYPAL_VERIFIED_EVIDENCE"},409);
      const evidence=await latestVerifiedPayPalEvidence(env.DATABASE_URL,sessionId);
      if(!evidence) return json({error:"VERIFIED_CAPTURE_EVIDENCE_NOT_FOUND"},409);

      const result=await finalizePayPalCaptureJob(env,{
        kind:"FINALIZE_PAYPAL_CAPTURE",payloadHash:evidence.payloadHash
      });
      const fresh=await getSession(env.DATABASE_URL,sessionId);
      return json({ok:true,replayedVerifiedEvidence:true,result,session:fresh});
    }

    const dispute=url.pathname.match(/^\/api\/trust-center\/disputes\/evidence\/([^/]+)$/);
    if(request.method==="GET"&&dispute){
      const sessionId=decodeURIComponent(dispute[1]);
      return json({evidence:await buildDisputeEvidence(env,sessionId,disputeReason(url.searchParams.get("reason")))});
    }

    const postPurchase=url.pathname.match(/^\/api\/trust-center\/post-purchase\/([^/]+)$/);
    if(request.method==="GET"&&postPurchase){
      const sessionId=decodeURIComponent(postPurchase[1]);
      return json(await getSessionPostPurchaseState(env,sessionId));
    }

    const refundEvaluate=url.pathname.match(/^\/api\/trust-center\/refunds\/evaluate\/([^/]+)$/);
    if(request.method==="POST"&&refundEvaluate){
      const sessionId=decodeURIComponent(refundEvaluate[1]);
      const b:any=await request.json();
      return json(await evaluateSessionRefund(env,sessionId,{
        amount:Number(b.amount),currency:b.currency?String(b.currency):undefined,reason:b.reason?String(b.reason):undefined
      }));
    }

    const refundRequest=url.pathname.match(/^\/api\/trust-center\/refunds\/request\/([^/]+)$/);
    if(request.method==="POST"&&refundRequest){
      if(!await validOpsRequest(request,env)) return json({error:"UNAUTHORIZED"},401);
      const sessionId=decodeURIComponent(refundRequest[1]);
      const b:any=await request.json();
      return json(await requestSessionRefund(env,sessionId,{
        amount:Number(b.amount),currency:b.currency?String(b.currency):undefined,reason:b.reason?String(b.reason):undefined
      }));
    }

    const refundSync=url.pathname.match(/^\/api\/trust-center\/refunds\/([^/]+)\/sync$/);
    if(request.method==="POST"&&refundSync){
      if(!await validOpsRequest(request,env)) return json({error:"UNAUTHORIZED"},401);
      return json(await syncSessionRefund(env,decodeURIComponent(refundSync[1])));
    }

    const disputesForSession=url.pathname.match(/^\/api\/trust-center\/disputes\/paypal\/session\/([^/]+)$/);
    if(request.method==="GET"&&disputesForSession){
      const sessionId=decodeURIComponent(disputesForSession[1]);
      return json({sessionId,disputes:await getSessionPayPalDisputes(env,sessionId)});
    }

    const paypalDispute=url.pathname.match(/^\/api\/trust-center\/disputes\/paypal\/([^/]+)$/);
    if(request.method==="GET"&&paypalDispute){
      return json({dispute:await getPayPalDispute(env,decodeURIComponent(paypalDispute[1]))});
    }

    const disputeSummary=url.pathname.match(/^\/api\/trust-center\/disputes\/paypal\/([^/]+)\/send-summary$/);
    if(request.method==="POST"&&disputeSummary){
      if(!await validOpsRequest(request,env)) return json({error:"UNAUTHORIZED"},401);
      const disputeId=decodeURIComponent(disputeSummary[1]);
      const b:any=await request.json();
      const sessionId=String(b.sessionId??"");
      if(!sessionId) return json({error:"SESSION_ID_REQUIRED"},400);
      const evidence=await buildDisputeEvidence(env,sessionId,disputeReason(b.reason?String(b.reason):null));
      const message=[
        `IntentLock evidence summary for ${sessionId}.`,
        `Original intent: ${evidence.session.userPrompt}`,
        `Policy decision: ${String(evidence.authorization?.decision??"UNKNOWN")}.`,
        `Provider capture: ${String(evidence.payment?.providerCaptureId??"missing")}.`,
        `Evidence completeness: ${evidence.evidenceCoverage.completeness}%.`,
        `Packet hash: ${evidence.packetHash}.`,
        `Audit chain valid: ${Boolean(evidence.proof?.auditChainValid)}.`
      ].join(" ");
      const result=await sendDisputeEvidenceSummary(env,disputeId,message);
      return json({ok:true,disputeId,sessionId,packetHash:evidence.packetHash,result});
    }

    if(request.method==="GET"&&url.pathname==="/api/trust-center/payees"){
      return json(publicPayeeLockConfig(env));
    }

    return json({error:"TRUST_CENTER_ROUTE_NOT_FOUND"},404);
  }catch(error){
    return json({
      error:"TRUST_CENTER_OPERATION_FAILED",
      message:error instanceof Error?error.message:String(error)
    },400);
  }
}
