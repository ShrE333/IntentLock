"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {Shell} from "../components/Shell";
import {getJson,postJson} from "../lib";

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
  walletId:string;name:string;countryCode:string;currency:string;totalAuthority:number;spentAmount:number;
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
type RunResult={session:Session;events:Event[];candidates:Candidate[];};

const pretty=(type:string)=>type.replaceAll("_"," ");
const money=(n:number,currency:string)=>new Intl.NumberFormat("en-US",{
  style:"currency",currency,maximumFractionDigits:["JPY","HUF","TWD"].includes(currency)?0:2
}).format(n);

function walletReadiness(wallet:Wallet){
  const remaining=Math.max(0,wallet.totalAuthority-wallet.spentAmount);
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
    CAPTURED:"Provider evidence, wallet ledger and session state agree. The purchase is complete.",
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
  const returnHandled=useRef(false);

  const wallet=useMemo(()=>wallets.find(w=>w.walletId===walletId)??null,[wallets,walletId]);
  const connector=useMemo(()=>connectors.find(c=>c.id===connectorId)??null,[connectors,connectorId]);
  const readiness=useMemo(()=>wallet?walletReadiness(wallet):null,[wallet,wallets]);
  const blockReasons=useMemo(()=>[...new Set(candidates.flatMap(c=>c.decision==="BLOCK"?[...c.violations,...c.reasons]:[]))],[candidates]);

  async function load(){
    try{
      const [w,c]=await Promise.all([
        getJson<{wallets:Wallet[]}>("/api/wallets"),
        getJson<{connectors:Connector[]}>("/api/commerce/connectors")
      ]);
      const enabled=c.connectors.filter(x=>x.enabled);
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
    try{
      const p=await getJson<{payment:Payment|null}>(`/api/sessions/${encodeURIComponent(id)}/payment`);
      setPayment(p.payment);
    }catch{}
    if(r.session.status==="CAPTURED") await load();
    return r.session;
  }
  async function refreshSession(){if(session) await refreshSessionById(session.sessionId);}

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
    setBusy("Starting autonomous purchase session…");setError("");setSession(null);setEvents([]);setCandidates([]);setStepResult(null);setPayment(null);
    try{
      const created=await postJson<{session:Session;events:Event[]}>("/api/sessions",{walletId,connectorId,prompt,channel:"WEB"});
      setSession(created.session);setEvents(created.events);setBusy("Agent searching, binding FX and evaluating wallet authority…");
      const run=await postJson<RunResult>(`/api/sessions/${encodeURIComponent(created.session.sessionId)}/run`,{});
      setSession(run.session);setEvents(run.events);setCandidates(run.candidates);
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

  return <Shell><div className="page">
    <header className="pageHeader"><div>
      <div className="eyebrow">INTENTLOCK V11.3 · TRANSACTION RELIABILITY</div>
      <h1>Autonomous Purchase</h1>
      <p>Discovery finds candidates. Wallet policy evaluates them independently. Payment then moves through an explicit provider state machine until verified settlement.</p>
    </div>{session&&<span className="sessionIdBadge">{session.sessionId}</span>}</header>

    <section className="purchaseSessionGrid">
      <article className="card purchaseLaunch">
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
        <button className="button buttonPrimary buttonWide" onClick={start} disabled={!!busy}>Start Autonomous Purchase</button>
      </article>

      <article className="card"><div className="cardHeader"><div><h2>Session State</h2><p>Recommendation ≠ permission. Provider response ≠ trusted capture.</p></div></div>
        {!session&&<div className="sessionEmpty">No purchase session started yet.</div>}
        {session&&<>
          <div className="sessionState">
            <State label="Status" value={session.status}/><State label="Wallet" value={wallet?.name??session.walletId}/>
            <State label="Connector" value={session.connectorId}/><State label="Decision" value={session.selectedDecision??"PENDING"}/>
            <State label="Payment rail" value={session.paymentProvider?.toUpperCase()??"Selected at checkout"}/>
            <State label="Order" value={session.providerOrderId??"Not created"}/><State label="Authorization" value={session.providerAuthorizationId??session.authorizationId??"Not created"}/>
            <State label="Capture" value={session.providerCaptureId??"Not requested"}/><State label="Proof Receipt" value={session.proofReceiptId??"Not generated"}/>
          </div>
          <div className="sessionEmpty">{statusHelp(session.status)}</div>
        </>}
      </article>
    </section>

    {busy&&<div className="alert alertInfo">{busy}</div>}
    {error&&<div className="alert alertError">{error}</div>}

    {session?.status==="BLOCKED"&&<section className="sessionSection"><article className="decisionCard block">
      <div className="decisionTop"><div><span className="miniLabel">WHY THIS SESSION STOPPED</span><h2>{candidates.length?"Policy rejected every returned candidate":"No marketplace candidates returned"}</h2></div></div>
      <div className="decisionReasons">
        {blockReasons.length?blockReasons.map(r=><span key={r}>{r.includes("_")?friendlyViolation(r):r}</span>):<span>Search returned no products. Try a simpler product query or another connector.</span>}
      </div>
      <p className="textMuted">These outcomes are computed from the selected wallet and returned product facts. They are not hard-coded transaction statuses.</p>
    </article></section>}

    {events.length>0&&<section className="sessionSection"><div className="sectionTitleRow"><div><span className="miniLabel">VISIBLE AGENT ACTIVITY</span><h2>Session Trace</h2></div><span className="traceCount">{events.length} EVENTS</span></div>
      <div className="agentTimeline">{events.map((event,index)=><div key={event.eventId} className="timelineEvent"><div className="timelineRail"><span className="timelineDot">{index+1}</span></div><div className="timelineBody"><div className="timelineTop"><strong>{pretty(event.eventType)}</strong><span>{new Date(event.occurredAt).toLocaleTimeString()}</span></div><EventDetails event={event} authorityCurrency={authorityCurrency}/></div></div>)}</div>
    </section>}

    {candidates.length>0&&<section className="sessionSection"><div className="sectionTitleRow"><div><span className="miniLabel">MULTI-CURRENCY MARKETPLACE EVALUATION</span><h2>Candidate Decisions</h2></div></div>
      <div className="sessionCandidates">{candidates.map(c=>{const selected=session?.selectedProduct?.id===c.product.id;const fx=c.product.authorizationContext?.fxQuote;return <article key={c.product.id} className={`sessionCandidate ${c.decision.toLowerCase()} ${selected?"selected":""}`}>
        <div className="candidateHead"><div><span>{c.product.merchant} · {c.product.merchantCountry??"--"}</span><h3>{c.product.title}</h3></div><strong>{money(c.product.price,c.product.currency)}</strong></div>
        <div className="candidateMeta">{c.product.brand} · {c.product.features.join(" · ")}</div>
        <div className="policyBox"><p>IntentLock authority cost: <strong>{money(c.walletAmount,c.walletCurrency)}</strong>{fx?` · FX ${fx.source}`:" · same currency"}</p></div>
        {fx&&<div className="quoteBinding"><span>FX quote · expires {new Date(fx.expiresAt).toLocaleTimeString()}</span><code>{fx.quoteId} · 1 {fx.fromCurrency} = {fx.rate.toFixed(6)} {fx.toCurrency}</code></div>}
        {c.product.merchantMessage&&<div className="untrustedMerchant"><div><span>MERCHANT INPUT</span><strong>UNTRUSTED</strong></div><p>{c.product.merchantMessage}</p></div>}
        <div className={`candidateDecision ${c.decision.toLowerCase()}`}><strong>{c.decision}</strong><span>{c.decision==="ALLOW"?"Inside normalized wallet authority":c.decision==="STEP_UP"?`Needs +${money(c.additionalAuthorityRequired,c.walletCurrency)}`:[...c.violations.map(friendlyViolation),...c.reasons].join(" · ")}</span></div>
        {selected&&<div className="selectedFlag">SELECTED BY SESSION</div>}
      </article>;})}</div>
    </section>}

    {session?.selectedProduct&&<section className="sessionSection">
      <article className="selectedPurchaseCard"><div><span className="miniLabel">SELECTED CANDIDATE</span><h2>{session.selectedProduct.title}</h2><p>{session.selectedProduct.merchant} · {session.selectedProduct.merchantCountry??selectedContext?.merchantCountry??"--"}</p></div><div className="selectedPrice">{money(session.selectedProduct.price,session.selectedProduct.currency)}</div></article>

      {selectedContext&&<article className="card"><div className="cardHeader"><div><span className="miniLabel">BOUND PAYMENT CONTEXT</span><h2>{money(selectedContext.presentmentAmount,selectedContext.presentmentCurrency)} → {money(selectedContext.walletAmount,selectedContext.walletCurrency)}</h2><p>Buyer {selectedContext.buyerCountry} · merchant {selectedContext.merchantCountry} · {selectedContext.fxQuote?`FX ${selectedContext.fxQuote.source}`:"same currency"}</p></div></div>{selectedContext.fxQuote&&<div className="quoteBinding"><span>FX quote is part of the authorization hash</span><code>{selectedContext.fxQuote.quoteId} · expires {new Date(selectedContext.fxQuote.expiresAt).toLocaleString()}</code></div>}</article>}

      {session.status==="AWAITING_STEP_UP"&&!stepResult&&<article className="sessionStepUp"><div><span className="miniLabel">HUMAN AUTHORITY REQUIRED</span><h2>Step-Up Approval</h2><p>The merchant quote is valid, but its normalized wallet cost exceeds autonomous authority.</p></div><div className="sessionStepActions"><button className="button buttonSecondary" onClick={()=>resolveStepUp("REJECT")}>Reject</button><button className="button buttonSecondary" onClick={()=>resolveStepUp("RAISE_LIMIT")}>Raise Limit</button><button className="button buttonPrimary" onClick={()=>resolveStepUp("ALLOW_ONCE")}>Allow Once {money(selectedContext?.walletAmount??session.selectedProduct.price,selectedContext?.walletCurrency??session.selectedProduct.currency)}</button></div></article>}

      {session.status==="READY_TO_PAY"&&<article className="readyToPay"><div><span className="miniLabel">INTENTLOCK AUTHORITY PASSED</span><h2>READY TO PAY</h2><p>IntentLock will now select a configured rail that can handle the merchant presentment currency/country. Checkout creation still does not mean capture.</p></div><button className="button buttonPrimary" onClick={createPayment} disabled={paymentBusy}>{paymentBusy?"Selecting payment rail…":`Create Authorized Checkout · ${money(session.selectedProduct.price,session.selectedProduct.currency)}`}</button></article>}

      {session.status==="PAYPAL_APPROVAL_PENDING"&&<article className="paymentPendingCard"><div><span className="miniLabel">PAYPAL ORDER CREATED · NOT PAID</span><h2>BUYER APPROVAL REQUIRED</h2><p>The transaction is pending because PayPal approval has not returned yet. Resume checkout in the same tab; after approval IntentLock will authorize, revalidate and request capture.</p></div><div className="paymentPendingActions"><button className="button buttonPrimary" onClick={resumePayment} disabled={paymentBusy}>Resume PayPal Approval</button><button className="button buttonSecondary" onClick={refreshSession}>Refresh Status</button></div></article>}

      {session.status==="AUTHORIZED"&&<article className="paymentPendingCard"><div><span className="miniLabel">PAYPAL FUNDS HELD</span><h2>AUTHORIZED — NOT CAPTURED</h2><p>Buyer approval succeeded. If a browser/network interruption stopped the next step, the idempotent capture request can be safely resumed.</p></div><button className="button buttonPrimary" onClick={resumePayment} disabled={paymentBusy}>Resume Safe Capture</button></article>}

      {session.status==="CAPTURE_PENDING"&&<article className="paymentPendingCard"><div><span className="miniLabel">CAPTURE REQUEST SENT</span><h2>WAITING FOR VERIFIED PAYPAL EVIDENCE</h2><p>This pending state is intentional: IntentLock will not trust the browser or capture API response alone. The verified webhook settles the wallet exactly once.</p></div><div className="paymentPendingActions"><button className="button buttonSecondary" onClick={refreshSession}>Refresh Status</button><a className="button buttonSecondary" href={`/trust-center?sessionId=${encodeURIComponent(session.sessionId)}`}>Inspect Transaction</a></div></article>}

      {session.status==="PAYMENT_PENDING"&&<article className="paymentPendingCard"><div><span className="miniLabel">PAYMENT EXECUTION</span><h2>WAITING FOR VERIFIED WEBHOOK</h2><p>The selected alternate rail remains webhook-gated.</p></div>{payment?.checkoutUrl&&<a className="button buttonPrimary" href={payment.checkoutUrl} target="_blank" rel="noreferrer">Open Checkout</a>}</article>}

      {session.status==="CAPTURED"&&<article className="capturedProofCard"><div><span className="miniLabel">VERIFIED PURCHASE</span><h2>PAYMENT CAPTURED</h2><p>Verified webhook · wallet authority debited once in its own currency · proof receipt generated.</p></div><div className="capturedActions"><strong>{money(Number(session.capturedAmount??session.selectedProduct.price),session.capturedCurrency??session.selectedProduct.currency)}</strong><a className="button buttonPrimary" href={`/proof/${encodeURIComponent(session.sessionId)}`}>View Proof Receipt</a><a className="button buttonSecondary" href={`/trust-center?sessionId=${encodeURIComponent(session.sessionId)}`}>Open Transaction Control</a></div></article>}
    </section>}
  </div></Shell>;
}

function Authority({label,value}:{label:string;value:string}){return <div><span>{label}</span><strong>{value}</strong></div>;}
function State({label,value}:{label:string;value:string}){return <div className="sessionStateRow"><span>{label}</span><strong>{value}</strong></div>;}
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
  return <p>{pretty(event.eventType)}</p>;
}
