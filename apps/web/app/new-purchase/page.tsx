"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {Shell} from "../components/Shell";
import {getJson,postJson} from "../lib";
import {refreshWithError} from '../runtime-config';
import {sandboxWalletAvailable} from '../demo-evidence';
import "./purchase-flow.css";

type FxQuote={
  quoteId:string;fromCurrency:string;toCurrency:string;rate:number;fromAmount:number;toAmount:number;
  source:string;quotedAt:string;expiresAt:string;
};
type PaymentAuthorizationContext={
  version:string;buyerCountry:string;merchantCountry:string;
  walletAmount:number;walletCurrency:string;presentmentAmount:number;presentmentCurrency:string;
  fxQuote:FxQuote|null;createdAt:string;
};
type Wallet={
  walletId:string;name:string;countryCode:string;currency:string;totalAuthority:number;spentAmount:number;reservedAmount?:number;
  autoBuyLimit:number;maxSingleTransaction:number;allowedCategories:string[];allowedBrands:string[];
  blockedBrands:string[];requiredFeatures:string[];validUntil:string;status:"ACTIVE"|"REVOKED";
};
type Connector={id:string;name:string;kind:string;enabled:boolean;description?:string;};
type Product={
  id:string;title:string;brand:string;category:string;merchant:string;merchantCountry?:string;
  price:number;currency:string;features:string[];merchantMessage?:string;
  authorizationContext?:PaymentAuthorizationContext;
};
type Candidate={
  product:Product;decision:"ALLOW"|"STEP_UP"|"BLOCK";violations:string[];reasons:string[];
  additionalAuthorityRequired:number;walletAmount:number;walletCurrency:string;
};
type Session={
  sessionId:string;walletId:string;connectorId:string;userPrompt:string;status:string;
  selectedProduct:Product|null;selectedDecision:"ALLOW"|"STEP_UP"|"BLOCK"|null;
  stepUpRequestId:string|null;authorizationId:string|null;quoteHash:string|null;
  paymentLinkUrl:string|null;paymentIdempotencyKey:string|null;
  paymentProvider:"paypal"|"razorpay"|null;providerOrderId:string|null;
  providerAuthorizationId:string|null;providerCaptureId:string|null;
  razorpayPaymentLinkId:string|null;razorpayPaymentId:string|null;
  capturedAmount:number|null;capturedCurrency:string|null;capturedAt:string|null;
  proofReceiptId:string|null;
};
type Event={eventSeq:number;eventId:string;eventType:string;payload:Record<string,unknown>;occurredAt:string;};
type Payment={
  provider:"paypal"|"razorpay";providerOrderId:string|null;providerAuthorizationId:string|null;
  providerCaptureId:string|null;checkoutUrl:string|null;amount:number;currency:string;status:string;
};
type AgentMode="live"|"compromised";
type AgentRun={
  mode:AgentMode;simulated:boolean;status:"OK"|"UNAVAILABLE";model:string|null;rankedProductIds:string[];
  recommendedProductId:string|null;proposedQuantity:number|null;rationale:string|null;unavailableReason?:string;
  overruled:boolean;overruleReasons:string[];selectedProductId:string|null;policyDecision?:string|null;
};
type RunResult={session:Session;events:Event[];candidates:Candidate[];agent?:AgentRun|null;};

const pretty=(type:string)=>type.replaceAll("_"," ");
const money=(n:number,currency:string)=>new Intl.NumberFormat("en-US",{
  style:"currency",currency,maximumFractionDigits:["JPY","HUF","TWD"].includes(currency)?0:2
}).format(n);

function walletReadiness(wallet:Wallet){
  const remaining=sandboxWalletAvailable(wallet);
  const expiresMs=new Date(wallet.validUntil).getTime();
  const msLeft=expiresMs-Date.now();
  if(wallet.status!=="ACTIVE") return {ready:false,label:"REVOKED",message:"This wallet is revoked.",remaining,msLeft};
  if(msLeft<=0) return {ready:false,label:"EXPIRED",message:"This wallet has expired. Create a fresh Intent Wallet before starting another purchase.",remaining,msLeft};
  if(remaining<=0) return {ready:false,label:"SPENT",message:"This wallet has no remaining authority.",remaining,msLeft};
  if(msLeft<15*60*1000) return {ready:false,label:"EXPIRING",message:"This wallet has less than 15 minutes remaining, so IntentLock will not start a new payment.",remaining,msLeft};
  return {ready:true,label:"READY",message:"Wallet is active and can start a new payment.",remaining,msLeft};
}

function connectorMode(connector:Connector|null){
  if(!connector) return "—";
  return ["EBAY","SHOPIFY","HTTP_JSON"].includes(connector.kind)?"LIVE":"DEMO";
}

function statusHelp(status:string){
  const map:Record<string,string>={
    CREATED:"Session created. Search has not started yet.",
    SEARCHING:"Marketplace discovery is running. Wallet policy has not been applied as a search filter.",
    READY_TO_PAY:"A candidate passed deterministic wallet policy and is ready for checkout.",
    AWAITING_STEP_UP:"The candidate is valid, but human authority is required for this exact quote.",
    BLOCKED:"No returned candidate satisfied the current wallet policy. Inspect the candidate reasons below.",
    PAYPAL_APPROVAL_PENDING:"PayPal checkout exists, but buyer approval has not completed yet.",
    PAYMENT_PENDING:"Checkout exists on the selected payment rail and is waiting for provider completion.",
    AUTHORIZED:"PayPal approved the order and placed an authorization hold. Capture has not completed yet.",
    CAPTURE_PENDING:"Capture was requested. IntentLock is waiting for verified provider evidence before settling the wallet.",
    CAPTURED:"Capture is recorded. Inspect the signed receipt and wallet ledger to verify the transaction.",
    FAILED:"Execution failed before trusted capture. Inspect the trace for the exact stage.",
    CANCELLED:"Checkout was cancelled before capture.",
    REJECTED:"A required human step-up was rejected."
  };
  return map[status]??status.replaceAll("_"," ");
}

function friendlyViolation(code:string){
  const map:Record<string,string>={
    WALLET_REVOKED:"Wallet revoked",WALLET_EXPIRED:"Wallet expired",
    CURRENCY_MISMATCH:"Currency normalization failed",
    MAX_SINGLE_TRANSACTION_EXCEEDED:"Above hard per-transaction ceiling",
    REMAINING_AUTHORITY_EXCEEDED:"Not enough remaining wallet authority",
    CATEGORY_NOT_ALLOWED:"Category not allowed",BRAND_BLOCKED:"Brand explicitly blocked",
    BRAND_NOT_ALLOWED:"Brand not allowed",REQUIRED_FEATURE_MISSING:"Required feature missing",
    PAYEE_NOT_TRUSTED:"Payee is not in the trusted registry",PAYEELOCK_REGISTRY_REQUIRED:"PayeeLock enforce mode has no registry",
    AUTHORIZATION_CONTEXT_UNAVAILABLE:"Could not bind payment/FX/payee context"
  };
  return map[code]??code.replaceAll("_"," ");
}

const AGENT_REASONS:Record<string,string>={
  RECOMMENDED_CANDIDATE_BLOCK:"Wallet policy blocked the product the agent recommended.",
  RECOMMENDED_CANDIDATE_STEP_UP:"The recommended product needs human step-up, so it cannot be bought autonomously.",
  QUANTITY_EXCEEDS_DELEGATION:"The agent proposed a quantity beyond what the user delegated.",
  MERCHANT_TEXT_INJECTION_SUSPECTED:"Merchant text looked like an instruction aimed at the agent, so the proposal was not trusted.",
  DIFFERENT_AUTHORIZED_CANDIDATE_SELECTED:"IntentLock selected a different candidate that policy authorizes."
};
function agentReason(code:string){
  if(AGENT_REASONS[code]) return AGENT_REASONS[code];
  const known=friendlyViolation(code);
  return known!==code.replaceAll("_"," ")?known:code;
}
const asStr=(v:unknown)=>typeof v==="string"?v:null;
const asStrArr=(v:unknown)=>Array.isArray(v)?v.filter((x):x is string=>typeof x==="string"):[];
// Rebuild the agent panel from persisted session events (used after refresh).
function agentFromEvents(events:Event[],session:Session|null):AgentRun|null{
  const rec=[...events].reverse().find(e=>e.eventType==="AGENT_RECOMMENDATION");
  if(!rec) return null;
  const over=[...events].reverse().find(e=>e.eventType==="AGENT_RECOMMENDATION_OVERRULED");
  const p=rec.payload,o=over?.payload;
  const mode:AgentMode=p.mode==="compromised"?"compromised":"live";
  return {
    mode,simulated:p.simulated===true,status:p.status==="UNAVAILABLE"?"UNAVAILABLE":"OK",
    model:asStr(p.model),rankedProductIds:asStrArr(p.rankedProductIds),
    recommendedProductId:asStr(p.recommendedProductId),
    proposedQuantity:typeof p.proposedQuantity==="number"?p.proposedQuantity:null,
    rationale:asStr(p.rationale),unavailableReason:asStr(p.unavailableReason)??undefined,
    overruled:!!over,overruleReasons:o?asStrArr(o.overruleReasons):[],
    selectedProductId:o?asStr(o.selectedProductId):(session?.selectedProduct?.id??null),
    policyDecision:o?asStr(o.policyDecision):(session?.selectedDecision??null)
  };
}

// ---- Presentation-only derived helpers (no I/O, no state transitions) ----
type StepState="done"|"current"|"pending"|"blocked"|"skipped";
type Step={key:string;label:string;state:StepState;note:string};
const STEP_LABELS=["Intent","Discovery","Agent proposal","Policy decision","Checkout","Buyer approval","Capture","Verified settlement","Proof"];

// Lifecycle position is derived only from session.status, falling back to recorded events.
function buildSteps(session:Session,events:Event[],agent:AgentRun|null):Step[]{
  const has=(...t:string[])=>events.some(e=>t.includes(e.eventType));
  const st=session.status;
  const proofDone=!!session.proofReceiptId||has("PROOF_RECEIPT_CREATED");
  const captured=st==="CAPTURED"||has("PAYMENT_CAPTURED","WALLET_SPEND_APPLIED");
  const fromEvents=()=>{
    if(proofDone) return 9;
    if(captured) return 8;
    if(has("PAYPAL_CAPTURE_REQUESTED")) return 7;
    if(has("PAYPAL_AUTHORIZED")) return 6;
    if(has("PAYMENT_CHECKOUT_CREATED")) return 5;
    if(has("POLICY_DECISION","CANDIDATE_SELECTED")) return 4;
    if(has("SEARCH_STARTED","DISCOVERY_QUERY_PLANNED","PRODUCT_FOUND")) return 1;
    return 1;
  };
  let cur=1,bad="",curNote="In progress";
  switch(st){
    case "CREATED":cur=1;curNote="Starting";break;
    case "SEARCHING":cur=1;curNote="Searching";break;
    case "AWAITING_STEP_UP":cur=3;curNote="Awaiting your approval";break;
    case "BLOCKED":cur=3;bad="Blocked";break;
    case "REJECTED":cur=3;bad="Rejected";break;
    case "READY_TO_PAY":cur=4;curNote="Ready";break;
    case "PAYPAL_APPROVAL_PENDING":case "PAYMENT_PENDING":cur=5;curNote="Awaiting buyer";break;
    case "AUTHORIZED":cur=6;curNote="Ready to capture";break;
    case "CAPTURE_PENDING":cur=7;curNote="Awaiting webhook";break;
    case "CAPTURED":cur=proofDone?9:8;curNote="Generating";break;
    case "FAILED":cur=Math.min(fromEvents(),8);bad="Failed";break;
    case "CANCELLED":cur=Math.min(fromEvents(),8);bad="Cancelled";break;
    default:cur=fromEvents();
  }
  return STEP_LABELS.map((label,i)=>{
    let state:StepState,note:string;
    if(i<cur){
      if(i===2&&(!agent||agent.status==="UNAVAILABLE")){state="skipped";note=agent?"Unavailable":"Not used";}
      else{state="done";note="Done";}
    }else if(i===cur){
      if(bad){state="blocked";note=bad;}else{state="current";note=curNote;}
    }else{state="pending";note="Pending";}
    return {key:label,label,state,note};
  });
}

type EventGroup={key:string;label:string;events:Event[];summary:string};
const REPEATED_EVENTS=new Set(["PRODUCT_FOUND","POLICY_DECISION","FX_QUOTE_BOUND","MERCHANT_TEXT_OBSERVED","PAYEE_IDENTITY_BOUND"]);
const PHASES:{key:string;label:string}[]=[
  {key:"discovery",label:"Discovery"},{key:"evaluation",label:"Evaluation"},{key:"agent",label:"Agent"},
  {key:"payment",label:"Payment"},{key:"settlement",label:"Settlement & proof"},{key:"other",label:"Other"}
];
function phaseOf(t:string){
  if(t.startsWith("AGENT_")) return "agent";
  if(["PAYPAL_WEBHOOK_VERIFIED","RAZORPAY_WEBHOOK_VERIFIED","PAYMENT_CAPTURED","WALLET_SPEND_APPLIED","PROOF_RECEIPT_CREATED"].includes(t)) return "settlement";
  if(["SESSION_CREATED","SEARCH_STARTED","DISCOVERY_QUERY_PLANNED","PRODUCT_FOUND","COMMERCE_NO_RESULTS"].includes(t)) return "discovery";
  if(["POLICY_DECISION","PAYEE_IDENTITY_BOUND","FX_QUOTE_BOUND","MERCHANT_TEXT_OBSERVED","CANDIDATE_SELECTED","SESSION_BLOCKED"].includes(t)||t.startsWith("STEP_UP")) return "evaluation";
  if(t.startsWith("PAYMENT_")||t.startsWith("PAYPAL_")||t.startsWith("RAZORPAY_")||t.startsWith("COMMERCE_QUOTE")) return "payment";
  return "other";
}
const plural=(n:number,one:string,many=one+"s")=>`${n} ${n===1?one:many}`;
function groupSummary(key:string,evs:Event[]):string{
  const has=(...t:string[])=>evs.some(e=>t.includes(e.eventType));
  const count=(t:string)=>evs.filter(e=>e.eventType===t).length;
  const last=(t:string)=>[...evs].reverse().find(e=>e.eventType===t);
  if(key==="discovery"){
    const n=count("PRODUCT_FOUND");
    if(n) return `${plural(n,"product")} found`;
    if(has("COMMERCE_NO_RESULTS")) return "No marketplace products matched";
    return has("SEARCH_STARTED","DISCOVERY_QUERY_PLANNED")?"Search started":"Session created";
  }
  if(key==="evaluation"){
    const d=(v:string)=>evs.filter(e=>e.eventType==="POLICY_DECISION"&&e.payload.decision===v).length;
    const parts:string[]=[];
    if(d("ALLOW")) parts.push(`${d("ALLOW")} allowed`);
    if(d("STEP_UP")) parts.push(`${d("STEP_UP")} step-up`);
    if(d("BLOCK")) parts.push(`${d("BLOCK")} blocked`);
    if(has("CANDIDATE_SELECTED")) parts.push("candidate selected");
    if(has("SESSION_BLOCKED")) parts.push("session blocked");
    return parts.length?parts.join(" · "):"Policy evaluation recorded";
  }
  if(key==="agent"){
    const rec=last("AGENT_RECOMMENDATION");
    if(rec?.payload.status==="UNAVAILABLE") return "Agent unavailable · fell back to marketplace order";
    const sim=rec?.payload.simulated===true||rec?.payload.mode==="compromised";
    const q=typeof rec?.payload.proposedQuantity==="number"?` × ${rec.payload.proposedQuantity}`:"";
    const base=rec?`${sim?"Simulated compromised agent":"AI agent"} proposed${q}`:"Agent activity";
    return has("AGENT_RECOMMENDATION_OVERRULED")?`${base} · overruled by policy`:rec?`${base} · policy agreed`:base;
  }
  if(key==="payment"){
    const parts:string[]=[];
    if(has("PAYMENT_RAIL_SELECTED")) parts.push("Rail selected");
    if(has("PAYMENT_CHECKOUT_CREATED")) parts.push("Checkout created");
    if(has("PAYPAL_AUTHORIZED")) parts.push("authorized");
    if(has("PAYPAL_CAPTURE_REQUESTED")) parts.push("capture requested");
    if(has("COMMERCE_QUOTE_CHANGED")) parts.push("quote changed, payment stopped");
    if(!parts.length&&has("PAYPAL_BUYER_APPROVAL_REQUIRED")) parts.push("Buyer approval required");
    return parts.length?parts.join(" · "):"Payment activity recorded";
  }
  if(key==="settlement"){
    const cap=last("PAYMENT_CAPTURED");
    const parts:string[]=[];
    if(cap) parts.push(`Verified webhook settled ${money(Number(cap.payload.amount),String(cap.payload.currency))}`);
    else if(has("PAYPAL_WEBHOOK_VERIFIED","RAZORPAY_WEBHOOK_VERIFIED")) parts.push("Webhook verified");
    if(has("WALLET_SPEND_APPLIED")) parts.push("wallet debited");
    if(has("PROOF_RECEIPT_CREATED")) parts.push("proof created");
    return parts.join(" · ")||"Settlement activity recorded";
  }
  return plural(evs.length,"event");
}
function buildGroups(events:Event[]):EventGroup[]{
  return PHASES.map(p=>{
    const evs=events.filter(e=>phaseOf(e.eventType)===p.key);
    return {key:p.key,label:p.label,events:evs,summary:groupSummary(p.key,evs)};
  }).filter(g=>g.events.length>0);
}
function shortId(v:string){return v.length>24?`${v.slice(0,12)}…${v.slice(-8)}`:v;}
function decisionLabel(d:string){return d==="STEP_UP"?"STEP UP":d;}

export default function AutonomousPurchasePage(){
  const [wallets,setWallets]=useState<Wallet[]>([]);
  const [connectors,setConnectors]=useState<Connector[]>([]);
  const [walletId,setWalletId]=useState("");
  const [connectorId,setConnectorId]=useState("");
  const [prompt,setPrompt]=useState("Find Sony or Bose wireless ANC headphones. Buy automatically if allowed.");
  const [session,setSession]=useState<Session|null>(null);
  const [events,setEvents]=useState<Event[]>([]);
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [stepResult,setStepResult]=useState<any>(null);
  const [payment,setPayment]=useState<Payment|null>(null);
  const [paymentBusy,setPaymentBusy]=useState(false);
  const [proofVerified,setProofVerified]=useState(false);
  const [agentMode,setAgentMode]=useState<AgentMode>("live");
  const [runAgent,setRunAgent]=useState<AgentRun|null>(null);
  const returnHandled=useRef(false);

  const wallet=useMemo(()=>wallets.find(w=>w.walletId===walletId)??null,[wallets,walletId]);
  const connector=useMemo(()=>connectors.find(c=>c.id===connectorId)??null,[connectors,connectorId]);
  const readiness=useMemo(()=>wallet?walletReadiness(wallet):null,[wallet,wallets]);
  const agent=useMemo(()=>runAgent??agentFromEvents(events,session),[runAgent,events,session]);
  const blockReasons=useMemo(()=>[...new Set(candidates.flatMap(c=>c.decision==="BLOCK"?[...c.violations,...c.reasons]:[]))],[candidates]);
  const steps=useMemo(()=>session?buildSteps(session,events,agent):[],[session,events,agent]);
  const groups=useMemo(()=>buildGroups(events),[events]);
  const candidateGroups=useMemo(()=>(["ALLOW","STEP_UP","BLOCK"] as const).map(d=>({decision:d,items:candidates.filter(c=>c.decision===d)})).filter(g=>g.items.length>0),[candidates]);

  async function load(){
    try{
      const [w,c]=await Promise.all([
        getJson<{wallets:Wallet[]}>("/api/wallets"),
        getJson<{connectors:Connector[]}>("/api/commerce/connectors")
      ]);
      const enabled=c.connectors.filter(x=>x.enabled&&x.id==='paypal-demo-marketplace');
      setWallets(w.wallets);setConnectors(enabled);
      if(!walletId){
        const firstReady=w.wallets.find(x=>walletReadiness(x).ready);
        if(firstReady) setWalletId(firstReady.walletId);
      }
      if(!enabled.some(x=>x.id===connectorId)){
        const preferred=
          enabled.find(x=>x.id==="ebay-browse")??
          enabled.find(x=>x.kind==="SHOPIFY"||x.kind==="HTTP_JSON")??
          enabled.find(x=>x.id==="paypal-demo-marketplace")??
          enabled[0];
        if(preferred) setConnectorId(preferred.id);
      }
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  }
  useEffect(()=>{load();},[]);

  async function refreshSessionById(id:string){
    const r=await getJson<{session:Session;events:Event[]}>(`/api/sessions/${encodeURIComponent(id)}`);
    setSession(r.session);setEvents(r.events);
    setProofVerified(false);
    if(r.session.status==='CAPTURED'){
      try{const proof=await getJson<{verification:{verified:boolean}}>(`/api/sessions/${encodeURIComponent(id)}/proof`);setProofVerified(proof.verification.verified===true);}
      catch{setProofVerified(false);}
    }
    try{
      const p=await getJson<{payment:Payment|null}>(`/api/sessions/${encodeURIComponent(id)}/payment`);
      setPayment(p.payment);
    }catch{}
    if(r.session.status==="CAPTURED") await load();
    return r.session;
  }
  async function refreshSession(){if(!session)return;await refreshWithError(()=>refreshSessionById(session.sessionId),e=>setError(e instanceof Error?e.message:String(e)));}

  // PayPal returns here after buyer approval. The browser cannot mark a purchase
  // captured; it only asks the backend to authorize and request capture.
  useEffect(()=>{
    if(returnHandled.current||typeof window==="undefined") return;
    const qs=new URLSearchParams(window.location.search);
    const state=qs.get("paypal");
    const id=qs.get("sessionId");
    if(!state||!id) return;
    returnHandled.current=true;
    (async()=>{
      try{
        if(state==="cancelled"){
          await refreshSessionById(id);
          setError("PayPal approval was cancelled. No capture was requested.");
          return;
        }
        setBusy("PayPal approved the order. IntentLock is authorizing the hold…");
        await refreshSessionById(id);
        await postJson(`/api/sessions/${encodeURIComponent(id)}/payment/authorize`,{});
        setBusy("Authorization received. Revalidating merchant quote, FX quote and policy before capture…");
        await postJson(`/api/sessions/${encodeURIComponent(id)}/payment/capture`,{});
        setBusy("Capture requested. Waiting for PayPal's verified webhook…");
        await refreshSessionById(id);
        window.history.replaceState({},"","/new-purchase");
      }catch(e){setError(e instanceof Error?e.message:String(e));}
      finally{setBusy("");}
    })();
  },[]);

  useEffect(()=>{
    if(!session||!["PAYMENT_PENDING","PAYPAL_APPROVAL_PENDING","AUTHORIZED","CAPTURE_PENDING"].includes(session.status)) return;
    const timer=setInterval(()=>{refreshSession();},3000);
    return ()=>clearInterval(timer);
  },[session?.sessionId,session?.status]);

  useEffect(()=>{
    if(typeof window==="undefined") return;
    const qs=new URLSearchParams(window.location.search);
    const id=qs.get("sessionId");
    const paypal=qs.get("paypal");
    if(id&&!paypal&&!session){
      refreshSessionById(id).catch(e=>setError(e instanceof Error?e.message:String(e)));
    }
  },[]);


  async function start(){
    if(!walletId){setError("Select an Intent Wallet first.");return;}
    if(!wallet){setError("Selected wallet could not be loaded.");return;}
    const preflight=walletReadiness(wallet);
    if(!preflight.ready){setError(preflight.message);return;}
    if(!connectorId){setError("Select an available commerce connector.");return;}
    if(!prompt.trim()){setError("Enter a purchase goal.");return;}
    setBusy("Starting autonomous purchase session…");setError("");setSession(null);setEvents([]);setCandidates([]);setStepResult(null);setPayment(null);setRunAgent(null);
    try{
      const created=await postJson<{session:Session;events:Event[]}>("/api/sessions",{walletId,connectorId,prompt,channel:"WEB"});
      setSession(created.session);setEvents(created.events);setBusy("Agent searching, binding FX and evaluating wallet authority…");
      const run=await postJson<RunResult>(`/api/sessions/${encodeURIComponent(created.session.sessionId)}/run`,{agentMode});
      setSession(run.session);setEvents(run.events);setCandidates(run.candidates);setRunAgent(run.agent??null);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  async function resolveStepUp(action:"ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT"){
    if(!session) return;setBusy("Resolving human step-up…");setError("");
    try{
      const r=await postJson<{result:any;session:Session;events:Event[]}>(`/api/sessions/${encodeURIComponent(session.sessionId)}/step-up/resolve`,{action});
      setStepResult(r.result);setSession(r.session);setEvents(r.events);if(action==="RAISE_LIMIT") await load();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  async function createPayment(){
    if(!session) return;setPaymentBusy(true);setError("");
    try{
      const r=await postJson<{payment:Payment|null}>(`/api/sessions/${encodeURIComponent(session.sessionId)}/payment`,{});
      if(!r.payment?.checkoutUrl) throw new Error("Payment approval URL was not returned.");
      setPayment(r.payment);
      // Use same-tab navigation. Opening a new window after awaited network calls is
      // frequently blocked by browsers, which left valid sessions stuck in
      // PAYPAL_APPROVAL_PENDING even though checkout creation succeeded.
      window.location.assign(r.payment.checkoutUrl);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setPaymentBusy(false);}
  }
  async function resumePayment(){
    if(!session) return;
    setPaymentBusy(true);setError("");
    try{
      if(session.status==="PAYPAL_APPROVAL_PENDING"){
        let current=payment;
        if(!current){
          const p=await getJson<{payment:Payment|null}>(`/api/sessions/${encodeURIComponent(session.sessionId)}/payment`);
          current=p.payment;setPayment(current);
        }
        if(!current?.checkoutUrl) throw new Error("PayPal approval URL is unavailable for this session.");
        window.location.assign(current.checkoutUrl);
        return;
      }
      if(session.status==="AUTHORIZED"){
        await postJson(`/api/sessions/${encodeURIComponent(session.sessionId)}/payment/capture`,{});
        await refreshSessionById(session.sessionId);
        return;
      }
      await refreshSessionById(session.sessionId);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setPaymentBusy(false);}
  }

  const authorityCurrency=wallet?.currency??session?.selectedProduct?.authorizationContext?.walletCurrency??"INR";
  const selectedContext=session?.selectedProduct?.authorizationContext;
  const selectedCand=session?.selectedProduct?candidates.find(c=>c.product.id===session.selectedProduct?.id)??null:null;
  const costAmount=selectedCand?.walletAmount??selectedContext?.walletAmount??null;
  const costCurrency=selectedCand?.walletCurrency??selectedContext?.walletCurrency??null;

  const launchCard=<article className="card purchaseLaunch">
        <div className="cardHeader"><div><h2>1. Delegate the task</h2><p>Select any wallet currency. Cross-currency products are normalized through a bound FX quote before policy evaluation.</p></div></div>
        <div className="sessionFormGrid">
          <label><span>Intent Wallet</span><select value={walletId} onChange={e=>setWalletId(e.target.value)}><option value="">Select wallet</option>{wallets.map(w=>{const r=walletReadiness(w);return <option key={w.walletId} value={w.walletId} disabled={!r.ready}>{w.name} · {w.countryCode} · {w.currency} · {r.label}</option>;})}</select></label>
          <label><span>Commerce Connector</span><select value={connectorId} onChange={e=>setConnectorId(e.target.value)}>{connectors.map(c=><option key={c.id} value={c.id}>{c.name} · {connectorMode(c)}</option>)}</select></label>
        </div>
        {wallet&&<div className="authorityBar">
          <Authority label="Buyer context" value={`${wallet.countryCode} · ${wallet.currency}`}/>
          <Authority label="Remaining" value={money(wallet.totalAuthority-wallet.spentAmount,wallet.currency)}/>
          <Authority label="Auto-buy" value={`≤ ${money(wallet.autoBuyLimit,wallet.currency)}`}/>
          <Authority label="Hard ceiling" value={money(wallet.maxSingleTransaction,wallet.currency)}/>
        </div>}
        {wallet&&readiness&&<div className={`alert ${readiness.ready?"alertInfo":"alertError"}`}>
          <strong>{readiness.label}</strong> · {readiness.message} {connector?`Connector: ${connector.name} (${connectorMode(connector)}).`:""}
          {!readiness.ready&&<> <a href="/wallets"><strong>Open Intent Wallets →</strong></a></>}
        </div>}
        {!wallets.some(w=>walletReadiness(w).ready)&&wallets.length>0&&<div className="alert alertError">No existing wallet can start a new payment. Create a fresh wallet or extend authority before testing another transaction.</div>}
        <label className="purchasePrompt"><span>Purchase goal</span><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={5}/></label>
        <fieldset className="agModeSet" disabled={!!busy}>
          <legend>Agent mode</legend>
          <div className="agModeGroup" role="radiogroup" aria-label="Agent mode">
            <label className={`agModeOpt ${agentMode==="live"?"on":""}`}>
              <input type="radio" name="agentMode" value="live" checked={agentMode==="live"} onChange={()=>setAgentMode("live")}/>
              <strong>Live AI agent</strong><small>A real model proposes what to buy. Policy still decides.</small>
            </label>
            <label className={`agModeOpt agModeSim ${agentMode==="compromised"?"on":""}`}>
              <input type="radio" name="agentMode" value="compromised" checked={agentMode==="compromised"} onChange={()=>setAgentMode("compromised")}/>
              <strong>Simulated compromised agent</strong><small>Simulates a jailbroken agent that obeys merchant text — for demonstrating the firewall.</small>
            </label>
          </div>
        </fieldset>
        <button className="button buttonPrimary buttonWide" onClick={start} disabled={!!busy}>Start Autonomous Purchase</button>
      </article>;

  const status=session?.status??"";
  const tone=status==="BLOCKED"||status==="FAILED"||status==="REJECTED"||status==="CANCELLED"?"blocked":status==="CAPTURED"?"done":"active";

  return <Shell><div className="page pf">
    <header className="pageHeader"><div>
      <div className="eyebrow">LIVE PURCHASE · DETERMINISTIC POLICY</div>
      <h1>Autonomous Purchase</h1>
      <p>Discovery finds candidates. Wallet policy evaluates them independently. Payment then moves through an explicit provider state machine until verified settlement.</p>
    </div>{session&&<span className="sessionIdBadge" title={session.sessionId}>{shortId(session.sessionId)}</span>}</header>

    {!session&&<section className="purchaseSessionGrid">
      {launchCard}
      <article className="card"><div className="cardHeader"><div><h2>Session State</h2><p>Recommendation ≠ permission. Provider response ≠ trusted capture.</p></div></div>
        <div className="sessionEmpty">No purchase session started yet.</div>
      </article>
    </section>}

    {busy&&<div className="alert alertInfo" role="status">{busy}</div>}
    {error&&<div className="alert alertError" role="alert">{error}</div>}

    {session&&<>
      <div className={`pf-strip pf-tone-${tone}`}>
        <span className={`pf-chip pf-chip-status pf-tone-${tone}`}>{pretty(session.status)}</span>
        <div className="pf-strip-item"><span>Wallet</span><strong>{wallet?.name??shortId(session.walletId)}</strong></div>
        <div className="pf-strip-item"><span>Decision</span><strong>{session.selectedDecision?decisionLabel(session.selectedDecision):"PENDING"}</strong></div>
        <div className="pf-strip-item"><span>{session.status==="CAPTURED"?"Captured":"Amount"}</span><strong>{session.status==="CAPTURED"&&session.capturedAmount!=null?money(Number(session.capturedAmount),session.capturedCurrency??session.selectedProduct?.currency??authorityCurrency):costAmount!=null&&costCurrency?money(costAmount,costCurrency):session.selectedProduct?money(session.selectedProduct.price,session.selectedProduct.currency):"—"}</strong></div>
      </div>

      <nav aria-label="Purchase lifecycle" className="pf-stepper">
        <ol className="pf-steps">{steps.map((s,i)=><li key={s.key} className={`pf-step pf-step-${s.state}`} aria-current={s.state==="current"||s.state==="blocked"?"step":undefined}>
          <span className="pf-step-mark" aria-hidden="true">{s.state==="done"?"✓":s.state==="blocked"?"!":s.state==="skipped"?"–":i+1}</span>
          <span className="pf-step-text"><span className="pf-step-label">{s.label}</span><span className="pf-step-note">{s.note}</span></span>
        </li>)}</ol>
      </nav>

      <section className={`pf-next pf-tone-${tone}`} aria-labelledby="pf-next-h">
        <div className="pf-next-top"><span className="pf-kicker" id="pf-next-h">NEXT ACTION</span><span className="pf-help">{statusHelp(session.status)}</span></div>
        {session.selectedProduct&&<div className="pf-product">
          <div className="pf-product-main"><span className="pf-product-merchant">{session.selectedProduct.merchant} · {session.selectedProduct.merchantCountry??selectedContext?.merchantCountry??"--"}</span><h2 className="pf-product-title">{session.selectedProduct.title}</h2></div>
          <dl className="pf-product-figures">
            <div><dt>Price</dt><dd>{money(session.selectedProduct.price,session.selectedProduct.currency)}</dd></div>
            <div><dt>Wallet cost</dt><dd>{costAmount!=null&&costCurrency?money(costAmount,costCurrency):"—"}</dd></div>
          </dl>
        </div>}

        {status==="BLOCKED"&&<div className="pf-action pf-action-block">
          <span className="pf-kicker">WHY THIS SESSION STOPPED</span>
          <h3>{candidates.length?"Policy rejected every returned candidate":"No marketplace candidates returned"}</h3>
          <ul className="pf-reasons">{blockReasons.length?blockReasons.map(r=><li key={r}>{r.includes("_")?friendlyViolation(r):r}</li>):<li>Search returned no products. Try a simpler product query or another connector.</li>}</ul>
          <p className="pf-fine">These outcomes are computed from the selected wallet and returned product facts. They are not hard-coded transaction statuses.</p>
        </div>}

        {session.selectedProduct&&<>
          {session.status==="AWAITING_STEP_UP"&&!stepResult&&<div className="pf-action"><span className="pf-kicker">HUMAN AUTHORITY REQUIRED</span><h3>Step-Up Approval</h3><p>The merchant quote is valid, but its normalized wallet cost exceeds autonomous authority.</p><div className="pf-actions"><button className="button buttonSecondary" onClick={()=>resolveStepUp("REJECT")}>Reject</button><button className="button buttonSecondary" onClick={()=>resolveStepUp("RAISE_LIMIT")}>Raise Limit</button><button className="button buttonPrimary" onClick={()=>resolveStepUp("ALLOW_ONCE")}>Allow Once {money(selectedContext?.walletAmount??session.selectedProduct.price,selectedContext?.walletCurrency??session.selectedProduct.currency)}</button></div></div>}

          {session.status==="READY_TO_PAY"&&<div className="pf-action"><span className="pf-kicker">INTENTLOCK AUTHORITY PASSED</span><h3>READY TO PAY</h3><p>IntentLock will now select a configured rail that can handle the merchant presentment currency/country. Checkout creation still does not mean capture.</p><div className="pf-actions"><button className="button buttonPrimary" onClick={createPayment} disabled={paymentBusy}>{paymentBusy?"Selecting payment rail…":`Create Authorized Checkout · ${money(session.selectedProduct.price,session.selectedProduct.currency)}`}</button></div></div>}

          {session.status==="PAYPAL_APPROVAL_PENDING"&&<div className="pf-action"><span className="pf-kicker">PAYPAL ORDER CREATED · NOT PAID</span><h3>BUYER APPROVAL REQUIRED</h3><p>The transaction is pending because PayPal approval has not returned yet. Resume checkout in the same tab; after approval IntentLock will authorize, revalidate and request capture.</p><div className="pf-actions"><button className="button buttonSecondary" onClick={refreshSession}>Refresh Status</button><button className="button buttonPrimary" onClick={resumePayment} disabled={paymentBusy}>Resume PayPal Approval</button></div></div>}

          {session.status==="AUTHORIZED"&&<div className="pf-action"><span className="pf-kicker">PAYPAL FUNDS HELD</span><h3>AUTHORIZED — NOT CAPTURED</h3><p>Buyer approval succeeded. If a browser/network interruption stopped the next step, the idempotent capture request can be safely resumed.</p><div className="pf-actions"><button className="button buttonPrimary" onClick={resumePayment} disabled={paymentBusy}>Resume Safe Capture</button></div></div>}

          {session.status==="CAPTURE_PENDING"&&<div className="pf-action"><span className="pf-kicker">CAPTURE REQUEST SENT</span><h3>WAITING FOR VERIFIED PAYPAL EVIDENCE</h3><p>This pending state is intentional: IntentLock will not trust the browser or capture API response alone. The verified webhook settles the wallet exactly once.</p><div className="pf-actions"><a className="button buttonSecondary" href={`/trust-center?sessionId=${encodeURIComponent(session.sessionId)}`}>Inspect Transaction</a><button className="button buttonPrimary" onClick={refreshSession}>Refresh Status</button></div></div>}

          {session.status==="PAYMENT_PENDING"&&<div className="pf-action"><span className="pf-kicker">PAYMENT EXECUTION</span><h3>WAITING FOR VERIFIED WEBHOOK</h3><p>The selected alternate rail remains webhook-gated.</p>{payment?.checkoutUrl&&<div className="pf-actions"><a className="button buttonPrimary" href={payment.checkoutUrl} target="_blank" rel="noreferrer">Open Checkout</a></div>}</div>}

          {session.status==="CAPTURED"&&<div className="pf-action pf-action-done"><span className="pf-kicker">{proofVerified?"VERIFIED PAYMENT":"CAPTURE RECORDED - PROOF NOT VERIFIED"}</span><h3>PAYMENT CAPTURED</h3><p>{proofVerified?"Provider evidence, wallet ledger and signed proof verified.":"Capture is recorded. Open the proof receipt to inspect its verification result."}</p><div className="pf-captured-amount">{money(Number(session.capturedAmount??session.selectedProduct.price),session.capturedCurrency??session.selectedProduct.currency)}</div><div className="pf-actions"><a className="button buttonSecondary" href={`/trust-center?sessionId=${encodeURIComponent(session.sessionId)}`}>Open Transaction Control</a><a className="button buttonPrimary" href={`/proof/${encodeURIComponent(session.sessionId)}`}>View Proof Receipt</a></div></div>}
        </>}

        {["CREATED","SEARCHING","FAILED","CANCELLED","REJECTED"].includes(status)&&<div className="pf-action"><p>{statusHelp(session.status)}</p></div>}

        {selectedContext&&<details className="pf-disclosure pf-context"><summary>Bound payment context · {money(selectedContext.presentmentAmount,selectedContext.presentmentCurrency)} → {money(selectedContext.walletAmount,selectedContext.walletCurrency)}</summary>
          <div className="pf-disclosure-body"><p>Buyer {selectedContext.buyerCountry} · merchant {selectedContext.merchantCountry} · {selectedContext.fxQuote?`FX ${selectedContext.fxQuote.source}`:"same currency"}</p>
          {selectedContext.fxQuote&&<p className="pf-code"><span>FX quote is part of the authorization hash</span><code>{selectedContext.fxQuote.quoteId} · expires {new Date(selectedContext.fxQuote.expiresAt).toLocaleString()}</code></p>}</div>
        </details>}
      </section>

      {agent&&<AgentPanel agent={agent} candidates={candidates} session={session} events={events}/>}

      {candidates.length>0&&<section className="pf-section" aria-labelledby="pf-cand-h">
        <div className="pf-section-head"><span className="pf-kicker">MULTI-CURRENCY MARKETPLACE EVALUATION</span><h2 id="pf-cand-h">Candidates <small>{candidates.length}</small></h2></div>
        {candidateGroups.map(g=><div key={g.decision} className="pf-cgroup">
          <h3 className={`pf-cgroup-head pf-d-${g.decision.toLowerCase()}`}><span>{decisionLabel(g.decision)}</span><b>{g.items.length}</b></h3>
          <ul className="pf-clist">{g.items.map(c=>{
            const selected=session.selectedProduct?.id===c.product.id;const fx=c.product.authorizationContext?.fxQuote;
            const reason=c.decision==="ALLOW"?"Inside normalized wallet authority":c.decision==="STEP_UP"?`Needs +${money(c.additionalAuthorityRequired,c.walletCurrency)}`:[...c.violations.map(friendlyViolation),...c.reasons].join(" · ");
            return <li key={c.product.id} className={`pf-cand pf-d-${c.decision.toLowerCase()} ${selected?"pf-cand-selected":""}`}>
              <div className="pf-cand-row">
                <div className="pf-cand-id"><h4>{c.product.title}</h4><span>{c.product.merchant} · {c.product.merchantCountry??"--"}</span></div>
                <div className="pf-cand-money"><strong>{money(c.product.price,c.product.currency)}</strong><span>Wallet {money(c.walletAmount,c.walletCurrency)}</span></div>
                <div className="pf-cand-verdict"><span className={`pf-chip pf-chip-${c.decision.toLowerCase()}`}>{decisionLabel(c.decision)}</span>{selected&&<span className="pf-selected">Selected</span>}</div>
                <p className="pf-cand-reason" title={reason}>{reason||"—"}</p>
              </div>
              <details className="pf-disclosure pf-cand-details"><summary>Details</summary>
                <div className="pf-disclosure-body">
                  <p>{c.product.brand}{c.product.features.length?` · ${c.product.features.join(" · ")}`:""}</p>
                  <p>IntentLock authority cost: <strong>{money(c.walletAmount,c.walletCurrency)}</strong>{fx?` · FX ${fx.source}`:" · same currency"}</p>
                  {fx&&<p className="pf-code"><span>FX quote · expires {new Date(fx.expiresAt).toLocaleTimeString()}</span><code>{fx.quoteId} · 1 {fx.fromCurrency} = {fx.rate.toFixed(6)} {fx.toCurrency}</code></p>}
                  {c.product.merchantMessage&&<div className="pf-untrusted"><div><span>MERCHANT INPUT</span><strong>UNTRUSTED</strong></div><p>{c.product.merchantMessage}</p></div>}
                </div>
              </details>
            </li>;})}</ul>
        </div>)}
      </section>}

      {groups.length>0&&<section className="pf-section" aria-labelledby="pf-act-h">
        <div className="pf-section-head"><span className="pf-kicker">VISIBLE AGENT ACTIVITY</span><h2 id="pf-act-h">Session activity</h2></div>
        <div className="pf-groups">{groups.map(g=>{
          const seen=new Set<string>();
          return <details key={g.key} className="pf-group">
            <summary><span className="pf-group-label">{g.label}</span><span className="pf-group-summary">{g.summary}</span></summary>
            <ul className="pf-group-list">{g.events.map(ev=>{
              if(REPEATED_EVENTS.has(ev.eventType)){
                if(seen.has(ev.eventType)) return null;
                seen.add(ev.eventType);
                const n=g.events.filter(x=>x.eventType===ev.eventType).length;
                return <li key={ev.eventId}><strong>{pretty(ev.eventType)} × {n}</strong><p>Summarized above; per-item detail is in Candidates and the technical trace.</p></li>;
              }
              return <li key={ev.eventId}><div className="pf-ev-top"><strong>{pretty(ev.eventType)}</strong><time>{new Date(ev.occurredAt).toLocaleTimeString()}</time></div><EventDetails event={ev} authorityCurrency={authorityCurrency}/></li>;
            })}</ul>
          </details>;})}
        </div>
        <details className="pf-disclosure pf-trace"><summary>Show technical trace ({events.length} events)</summary>
          <div className="agentTimeline">{events.map((event,index)=><div key={event.eventId} className="timelineEvent"><div className="timelineRail"><span className="timelineDot">{index+1}</span></div><div className="timelineBody"><div className="timelineTop"><strong>{pretty(event.eventType)}</strong><span>{new Date(event.occurredAt).toLocaleTimeString()}</span></div><EventDetails event={event} authorityCurrency={authorityCurrency}/></div></div>)}</div>
        </details>
      </section>}

      <details className="pf-disclosure pf-tech"><summary>Technical details</summary>
        <dl className="pf-tech-grid">
          <TechRow label="Session" value={session.sessionId}/>
          <TechRow label="Connector" value={session.connectorId}/>
          <TechRow label="Payment rail" value={session.paymentProvider?.toUpperCase()??"Selected at checkout"}/>
          <TechRow label="Order" value={session.providerOrderId??"Not created"}/>
          <TechRow label="Authorization" value={session.providerAuthorizationId??session.authorizationId??"Not created"}/>
          <TechRow label="Capture" value={session.providerCaptureId??"Not requested"}/>
          <TechRow label="Proof receipt" value={session.proofReceiptId??"Not generated"}/>
        </dl>
      </details>

      <details className="pf-disclosure pf-restart"><summary>Start another purchase</summary>
        <div className="pf-disclosure-body">{launchCard}</div>
      </details>
    </>}
  </div></Shell>;
}

function TechRow({label,value}:{label:string;value:string}){return <div className="pf-tech-row"><dt>{label}</dt><dd title={value}>{shortId(value)}</dd></div>;}
function Authority({label,value}:{label:string;value:string}){return <div><span>{label}</span><strong>{value}</strong></div>;}
function State({label,value}:{label:string;value:string}){return <div className="sessionStateRow"><span>{label}</span><strong>{value}</strong></div>;}
function AgentPanel({agent,candidates,session,events}:{agent:AgentRun;candidates:Candidate[];session:Session|null;events:Event[]}){
  const titleOf=(id:string|null)=>{
    if(!id) return null;
    const c=candidates.find(x=>x.product.id===id);
    if(c) return c.product.title;
    if(session?.selectedProduct?.id===id) return session.selectedProduct.title;
    const f=events.find(e=>e.eventType==="PRODUCT_FOUND"&&(e.payload.productId===id||e.payload.id===id));
    return f&&typeof f.payload.title==="string"?f.payload.title:null;
  };
  const labelOf=(id:string|null)=>{const t=titleOf(id);return t??(id?`Product ${id}`:null);};
  const selectedCand=candidates.find(x=>x.product.id===agent.selectedProductId);
  const selectedTitle=labelOf(agent.selectedProductId);
  const decision=agent.policyDecision??session?.selectedDecision??(agent.selectedProductId?null:"BLOCK");
  const sim=agent.simulated||agent.mode==="compromised";
  const headId="ag-head";
  if(agent.status==="UNAVAILABLE") return <section className="sessionSection agPanel" aria-labelledby={headId}>
    <div className="sectionTitleRow"><div><span className="miniLabel">AGENT PROPOSAL VS INTENTLOCK DECISION</span><h2 id={headId}>Agent unavailable</h2></div></div>
    <p className="agNotice" role="status">AI agent unavailable{agent.unavailableReason?` (${agent.unavailableReason})`:""} — fell back to marketplace order; policy unaffected.</p>
  </section>;
  return <section className="sessionSection agPanel" aria-labelledby={headId}>
    <div className="sectionTitleRow"><div><span className="miniLabel">AGENT PROPOSAL VS INTENTLOCK DECISION</span><h2 id={headId}>The agent proposed. Policy decided.</h2></div>
      {sim&&<span className="agBadge agBadgeSim">SIMULATED</span>}</div>
    <div className="agSplit">
      <article className="agSide agProposal">
        <span className="agTag">AGENT PROPOSED</span>
        <h3>{labelOf(agent.recommendedProductId)??"No product recommended"}</h3>
        <dl className="agFacts">
          <div><dt>Quantity</dt><dd>{agent.proposedQuantity??"—"}</dd></div>
          <div><dt>Model</dt><dd>{agent.model??(sim?"scripted simulation":"—")}</dd></div>
        </dl>
        {agent.rationale&&<figure className="agQuote">
          <figcaption>Untrusted model output</figcaption>
          <blockquote>{agent.rationale}</blockquote>
        </figure>}
      </article>
      <div className="agArrow" aria-hidden="true">⟶</div>
      <article className={`agSide agDecision ${agent.overruled?"overruled":"agreed"}`}>
        <span className="agTag">INTENTLOCK DECIDED</span>
        <h3>{agent.selectedProductId?selectedTitle:"Nothing authorized"}</h3>
        <div className="agDecisionRow">
          {decision&&<span className={`agVerdict ${decision.toLowerCase()}`}>{decision==="BLOCK"?"BLOCKED":decision==="STEP_UP"?"STEP-UP":decision}</span>}
          {selectedCand&&<span className="agPrice">{money(selectedCand.walletAmount,selectedCand.walletCurrency)}</span>}
        </div>
        {!agent.overruled&&<p className="agAgree">Policy independently authorized the agent&apos;s pick.</p>}
      </article>
    </div>
    {agent.overruled&&<div className="agOverrule" role="alert">
      <div className="agOverruleHead"><strong>Agent overruled</strong><span>Recommendation ≠ permission</span></div>
      <ul>{agent.overruleReasons.length?agent.overruleReasons.map(r=><li key={r}>{agentReason(r)}</li>):<li>Policy did not accept the agent&apos;s proposal.</li>}</ul>
    </div>}
  </section>;
}

function EventDetails({event,authorityCurrency}:{event:Event;authorityCurrency:string}){
  const p=event.payload;
  if(event.eventType==="DISCOVERY_QUERY_PLANNED") return <p>Marketplace search query: <strong>{String(p.searchQuery)}</strong>. Wallet rules are evaluated only after discovery.</p>;
  if(event.eventType==="COMMERCE_NO_RESULTS") return <p>No marketplace products matched <strong>{String(p.searchQuery)}</strong>. This is a discovery outcome, not a policy rejection.</p>;
  if(event.eventType==="PAYEE_IDENTITY_BOUND") return <p>PayeeLock bound <strong>{String(p.provider)}</strong> payee <strong>{String(p.payeeId)}</strong> before payment authorization.</p>;
  if(event.eventType==="PRODUCT_FOUND") return <p>{String(p.merchant)} found {String(p.title)} at {money(Number(p.price),String(p.currency??authorityCurrency))} · merchant {String(p.merchantCountry??"--")}</p>;
  if(event.eventType==="FX_QUOTE_BOUND") return <p>FX bound: {money(Number(p.presentmentAmount),String(p.presentmentCurrency))} → {money(Number(p.walletAmount),String(p.walletCurrency))} · {String(p.fxSource)} · {String(p.fxQuoteId)}</p>;
  if(event.eventType==="POLICY_DECISION") return <p>{String(p.title)} → <strong>{String(p.decision)}</strong> in {String(p.walletCurrency??authorityCurrency)} authority.</p>;
  if(event.eventType==="MERCHANT_TEXT_OBSERVED") return <p><strong>UNTRUSTED merchant text isolated from authorization.</strong></p>;
  if(event.eventType==="COMMERCE_QUOTE_REVALIDATED") return <p>Merchant quote and bound wallet authority revalidated immediately before a sensitive payment transition.</p>;
  if(event.eventType==="COMMERCE_QUOTE_CHANGED") return <p>Merchant/FX-bound quote changed after authorization. IntentLock stopped payment and requires re-authorization.</p>;
  if(event.eventType==="PAYMENT_RAIL_SELECTED") return <p>Capability engine selected <strong>{String(p.provider).toUpperCase()}</strong> for {money(Number(p.presentmentAmount),String(p.presentmentCurrency))} · buyer {String(p.buyerCountry)} · merchant {String(p.merchantCountry)}.</p>;
  if(event.eventType==="PAYMENT_CHECKOUT_CREATED") return <p>{String(p.provider).toUpperCase()} checkout created · {money(Number(p.amount),String(p.currency))} · wallet authority {money(Number(p.walletAmount),String(p.walletCurrency))}.</p>;
  if(event.eventType==="PAYPAL_BUYER_APPROVAL_REQUIRED") return <p>PayPal order uses AUTHORIZE intent; buyer approval is still required.</p>;
  if(event.eventType==="PAYPAL_AUTHORIZED") return <p>PayPal authorization hold created. Funds are not yet captured.</p>;
  if(event.eventType==="PAYPAL_CAPTURE_REQUESTED") return <p>Capture requested; trusted CAPTURED state remains false until verified webhook.</p>;
  if(event.eventType==="PAYPAL_WEBHOOK_VERIFIED"||event.eventType==="RAZORPAY_WEBHOOK_VERIFIED") return <p>Provider webhook signature verified before processing.</p>;
  if(event.eventType==="PAYMENT_CAPTURED") return <p>Verified capture accepted. Provider moved {money(Number(p.amount),String(p.currency))}; IntentLock wallet debit is {money(Number(p.walletAmount),String(p.walletCurrency))}.</p>;
  if(event.eventType==="WALLET_SPEND_APPLIED") return <p>Wallet debited exactly once: {money(Number(p.amount),String(p.currency))}; replay-safe ledger updated.</p>;
  if(event.eventType==="PROOF_RECEIPT_CREATED") return <p>Cryptographic proof receipt generated.</p>;
  if(event.eventType==="AGENT_RECOMMENDATION"){
    const sim=p.simulated===true||p.mode==="compromised";
    if(p.status==="UNAVAILABLE") return <p>AI agent unavailable{p.unavailableReason?` (${String(p.unavailableReason)})`:""}; fell back to marketplace order. Policy unaffected.</p>;
    return <p>{sim?"Simulated compromised agent":"AI agent"}{typeof p.model==="string"?` (${p.model})`:""} proposed {p.recommendedProductId?<strong>{String(p.recommendedProductId)}</strong>:"no product"}{typeof p.proposedQuantity==="number"?` × ${p.proposedQuantity}`:""}. <strong>Untrusted model output</strong>; policy decides.</p>;
  }
  if(event.eventType==="AGENT_RECOMMENDATION_OVERRULED"){
    const rs=asStrArr(p.overruleReasons).map(agentReason).join(" · ");
    return <p><strong>IntentLock overruled the agent.</strong> {p.selectedProductId?<>Selected <strong>{String(p.selectedProductId)}</strong> instead.</>:"Nothing was authorized."}{rs?` ${rs}`:""}</p>;
  }
  return <p>{pretty(event.eventType)}</p>;
}
