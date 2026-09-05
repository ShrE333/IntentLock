"use client";

import {useEffect,useMemo,useState} from "react";
import {Shell} from "../components/Shell";
import {getJson,postJson} from "../lib";

type Wallet={
  walletId:string;
  name:string;
  totalAuthority:number;
  spentAmount:number;
  autoBuyLimit:number;
  maxSingleTransaction:number;
  allowedBrands:string[];
  blockedBrands:string[];
  requiredFeatures:string[];
};

type Connector={
  id:string;
  name:string;
  enabled:boolean;
};

type Product={
  id:string;
  title:string;
  brand:string;
  category:string;
  merchant:string;
  price:number;
  currency:string;
  features:string[];
  merchantMessage?:string;
};

type Candidate={
  product:Product;
  decision:"ALLOW"|"STEP_UP"|"BLOCK";
  violations:string[];
  reasons:string[];
  additionalAuthorityRequired:number;
};

type Session={
  sessionId:string;
  walletId:string;
  connectorId:string;
  userPrompt:string;
  status:string;
  selectedProduct:Product|null;
  selectedDecision:"ALLOW"|"STEP_UP"|"BLOCK"|null;
  stepUpRequestId:string|null;
  authorizationId:string|null;

  quoteHash:string|null;
  paymentLinkUrl:string|null;
  paymentIdempotencyKey:string|null;

  razorpayPaymentLinkId:string|null;
  razorpayPaymentId:string|null;

  capturedAmount:number|null;
  capturedCurrency:string|null;
  capturedAt:string|null;

  proofReceiptId:string|null;
};

type Event={
  eventSeq:number;
  eventId:string;
  eventType:string;
  payload:Record<string,unknown>;
  occurredAt:string;
};

type RunResult={
  session:Session;
  events:Event[];
  candidates:Candidate[];
};

const pretty=(type:string)=>type.replaceAll("_"," ");

export default function AutonomousPurchasePage(){
  const [wallets,setWallets]=useState<Wallet[]>([]);
  const [connectors,setConnectors]=useState<Connector[]>([]);
  const [walletId,setWalletId]=useState("");
  const [connectorId,setConnectorId]=useState("demo-marketplace");
  const [prompt,setPrompt]=useState(
    "Find Sony or Bose wireless ANC headphones under ₹7,000. Buy automatically if allowed."
  );

  const [session,setSession]=useState<Session|null>(null);
  const [events,setEvents]=useState<Event[]>([]);
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [stepResult,setStepResult]=useState<any>(null);
  const [paymentLink,setPaymentLink]=useState<string>("");
  const [paymentBusy,setPaymentBusy]=useState(false);

  const wallet=useMemo(
    ()=>wallets.find(w=>w.walletId===walletId)??null,
    [wallets,walletId]
  );

  async function load(){
    try{
      const [w,c]=await Promise.all([
        getJson<{wallets:Wallet[]}>("/api/wallets"),
        getJson<{connectors:Connector[]}>("/api/commerce/connectors")
      ]);
      setWallets(w.wallets);
      setConnectors(c.connectors.filter(x=>x.enabled));

      if(w.wallets[0]) setWalletId(w.wallets[0].walletId);
      const preferred=c.connectors.find(
        x=>x.enabled && x.id==="shopify-storefront"
      ) ?? c.connectors.find(x=>x.enabled);
      if(preferred) setConnectorId(preferred.id);
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }
  }

  useEffect(()=>{load();},[]);

  async function start(){
    if(!walletId){setError("Select an Intent Wallet first.");return;}
    if(!prompt.trim()){setError("Enter a purchase goal.");return;}

    setBusy("Starting autonomous purchase session…");
    setError("");
    setSession(null);
    setEvents([]);
    setCandidates([]);
    setStepResult(null);
    setPaymentLink("");

    try{
      const created=await postJson<{session:Session;events:Event[]}>(
        "/api/sessions",
        {
          walletId,
          connectorId,
          prompt,
          channel:"WEB"
        }
      );

      setSession(created.session);
      setEvents(created.events);

      setBusy("Agent searching and evaluating marketplace…");

      const run=await postJson<RunResult>(
        `/api/sessions/${encodeURIComponent(created.session.sessionId)}/run`,
        {}
      );

      setSession(run.session);
      setEvents(run.events);
      setCandidates(run.candidates);
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }finally{
      setBusy("");
    }
  }

  async function resolveStepUp(action:"ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT"){
    if(!session) return;

    setBusy(
      action==="ALLOW_ONCE"
        ? "Signing one-time approval…"
        : action==="RAISE_LIMIT"
          ? "Raising autonomous authority…"
          : "Rejecting transaction…"
    );

    setError("");

    try{
      const r=await postJson<{
        result:any;
        session:Session;
        events:Event[];
      }>(
        `/api/sessions/${encodeURIComponent(session.sessionId)}/step-up/resolve`,
        {action}
      );

      setStepResult(r.result);
      setSession(r.session);
      setEvents(r.events);

      if(action==="RAISE_LIMIT") await load();
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }finally{
      setBusy("");
    }
  }


  async function refreshSession(){
    if(!session) return;
    try{
      const r=await getJson<{session:Session;events:Event[]}>(
        `/api/sessions/${encodeURIComponent(session.sessionId)}`
      );
      setSession(r.session);
      setEvents(r.events);
      if(r.session.paymentLinkUrl) setPaymentLink(r.session.paymentLinkUrl);
      if(r.session.status==="CAPTURED") await load();
    }catch{}
  }

  useEffect(()=>{
    if(!session || session.status!=="PAYMENT_PENDING") return;
    const timer=setInterval(()=>{refreshSession();},3000);
    return ()=>clearInterval(timer);
  },[session?.sessionId,session?.status]);

  async function createPayment(){
    if(!session) return;

    setPaymentBusy(true);
    setError("");

    try{
      const r=await postJson<{
        paymentLink:{
          shortUrl:string;
          status:string;
        }|null;
      }>(
        `/api/sessions/${encodeURIComponent(session.sessionId)}/payment-link`,
        {}
      );

      if(!r.paymentLink?.shortUrl)
        throw new Error("Razorpay Payment Link was not returned.");

      setPaymentLink(r.paymentLink.shortUrl);
      await refreshSession();
      window.open(r.paymentLink.shortUrl,"_blank","noopener,noreferrer");
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }finally{
      setPaymentBusy(false);
    }
  }

  return <Shell><div className="page">
    <header className="pageHeader">
      <div>
        <div className="eyebrow">UNIFIED AUTONOMOUS COMMERCE</div>
        <h1>Autonomous Purchase</h1>
        <p>One session from delegated authority to product discovery, policy evaluation and approval.</p>
      </div>

      {session && <span className="sessionIdBadge">{session.sessionId}</span>}
    </header>

    <section className="purchaseSessionGrid">
      <article className="card purchaseLaunch">
        <div className="cardHeader"><div>
          <h2>1. Delegate the task</h2>
          <p>The agent operates only inside the selected Intent Wallet.</p>
        </div></div>

        <div className="sessionFormGrid">
          <label>
            <span>Intent Wallet</span>
            <select value={walletId} onChange={e=>setWalletId(e.target.value)}>
              <option value="">Select wallet</option>
              {wallets.map(w=><option key={w.walletId} value={w.walletId}>{w.name}</option>)}
            </select>
          </label>

          <label>
            <span>Commerce Connector</span>
            <select value={connectorId} onChange={e=>setConnectorId(e.target.value)}>
              {connectors.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        {wallet && <div className="authorityBar">
          <Authority label="Remaining" value={`₹${(wallet.totalAuthority-wallet.spentAmount).toLocaleString("en-IN")}`}/>
          <Authority label="Auto-buy" value={`≤ ₹${wallet.autoBuyLimit.toLocaleString("en-IN")}`}/>
          <Authority label="Hard ceiling" value={`₹${wallet.maxSingleTransaction.toLocaleString("en-IN")}`}/>
          <Authority label="Allowed" value={wallet.allowedBrands.join(", ")||"Any"}/>
        </div>}

        <label className="purchasePrompt">
          <span>Purchase goal</span>
          <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={5}/>
        </label>

        <button className="button buttonPrimary buttonWide" onClick={start} disabled={!!busy}>
          Start Autonomous Purchase
        </button>
      </article>

      <article className="card">
        <div className="cardHeader"><div>
          <h2>Session State</h2>
          <p>Every downstream action is bound to this purchase session.</p>
        </div></div>

        {!session && <div className="sessionEmpty">No purchase session started yet.</div>}

        {session && <div className="sessionState">
          <State label="Status" value={session.status}/>
          <State label="Wallet" value={wallet?.name??session.walletId}/>
          <State label="Connector" value={session.connectorId}/>
          <State label="Decision" value={session.selectedDecision??"PENDING"}/>
          <State label="Authorization" value={session.authorizationId??"Wallet policy"}/>
          <State label="Payment" value={session.razorpayPaymentId??session.razorpayPaymentLinkId??"Not started"}/>
          <State label="Proof Receipt" value={session.proofReceiptId??"Not generated"}/>
        </div>}
      </article>
    </section>

    {busy && <div className="alert alertInfo">{busy}</div>}
    {error && <div className="alert alertError">{error}</div>}

    {events.length>0 && <section className="sessionSection">
      <div className="sectionTitleRow">
        <div>
          <span className="miniLabel">VISIBLE AGENT ACTIVITY</span>
          <h2>Session Trace</h2>
        </div>
        <span className="traceCount">{events.length} EVENTS</span>
      </div>

      <div className="agentTimeline">
        {events.map((event,index)=><div key={event.eventId} className="timelineEvent">
          <div className="timelineRail">
            <span className="timelineDot">{index+1}</span>
          </div>
          <div className="timelineBody">
            <div className="timelineTop">
              <strong>{pretty(event.eventType)}</strong>
              <span>{new Date(event.occurredAt).toLocaleTimeString()}</span>
            </div>
            <EventDetails event={event}/>
          </div>
        </div>)}
      </div>
    </section>}

    {candidates.length>0 && <section className="sessionSection">
      <div className="sectionTitleRow">
        <div>
          <span className="miniLabel">MARKETPLACE EVALUATION</span>
          <h2>Candidate Decisions</h2>
        </div>
      </div>

      <div className="sessionCandidates">
        {candidates.map(c=>{
          const selected=session?.selectedProduct?.id===c.product.id;
          return <article key={c.product.id}
            className={`sessionCandidate ${c.decision.toLowerCase()} ${selected?"selected":""}`}>
            <div className="candidateHead">
              <div>
                <span>{c.product.merchant}</span>
                <h3>{c.product.title}</h3>
              </div>
              <strong>₹{c.product.price.toLocaleString("en-IN")}</strong>
            </div>

            <div className="candidateMeta">{c.product.brand} · {c.product.features.join(" · ")}</div>

            {c.product.merchantMessage && <div className="untrustedMerchant">
              <div><span>MERCHANT INPUT</span><strong>UNTRUSTED</strong></div>
              <p>{c.product.merchantMessage}</p>
            </div>}

            <div className={`candidateDecision ${c.decision.toLowerCase()}`}>
              <strong>{c.decision}</strong>
              <span>
                {c.decision==="ALLOW"
                  ? "Inside autonomous authority"
                  : c.decision==="STEP_UP"
                    ? `Needs +₹${c.additionalAuthorityRequired.toLocaleString("en-IN")}`
                    : c.violations.join(" · ")}
              </span>
            </div>

            {selected && <div className="selectedFlag">SELECTED BY SESSION</div>}
          </article>;
        })}
      </div>
    </section>}

    {session?.selectedProduct && <section className="sessionSection">
      <article className="selectedPurchaseCard">
        <div>
          <span className="miniLabel">SELECTED CANDIDATE</span>
          <h2>{session.selectedProduct.title}</h2>
          <p>{session.selectedProduct.merchant} · {session.selectedProduct.brand}</p>
        </div>
        <div className="selectedPrice">₹{session.selectedProduct.price.toLocaleString("en-IN")}</div>
      </article>

      {session.status==="AWAITING_STEP_UP" && !stepResult && <article className="sessionStepUp">
        <div>
          <span className="miniLabel">HUMAN AUTHORITY REQUIRED</span>
          <h2>Step-Up Approval</h2>
          <p>The candidate is valid, but it exceeds this wallet's autonomous limit.</p>
        </div>

        <div className="sessionStepActions">
          <button className="button buttonSecondary" onClick={()=>resolveStepUp("REJECT")} disabled={!!busy}>Reject</button>
          <button className="button buttonSecondary" onClick={()=>resolveStepUp("RAISE_LIMIT")} disabled={!!busy}>Raise Limit</button>
          <button className="button buttonPrimary" onClick={()=>resolveStepUp("ALLOW_ONCE")} disabled={!!busy}>
            Allow Once ₹{session.selectedProduct.price.toLocaleString("en-IN")}
          </button>
        </div>
      </article>}

      {session.status==="READY_TO_PAY" && <article className="readyToPay">
        <div>
          <span className="miniLabel">AUTHORIZATION STATE</span>
          <h2>READY TO PAY</h2>
          <p>
            {session.authorizationId
              ? "Signed one-time authority is attached. IntentLock will consume it exactly once when checkout starts."
              : "The selected candidate is still inside autonomous wallet authority at execution time."}
          </p>
        </div>
        <button
          className="button buttonPrimary"
          onClick={createPayment}
          disabled={paymentBusy}
        >
          {paymentBusy?"Creating Razorpay Link…":`Create Razorpay Checkout · ₹${session.selectedProduct.price.toLocaleString("en-IN")}`}
        </button>
      </article>}

      {session.status==="PAYMENT_PENDING" && <article className="paymentPendingCard">
        <div>
          <span className="miniLabel">PAYMENT EXECUTION</span>
          <h2>WAITING FOR RAZORPAY</h2>
          <p>
            IntentLock has created exactly one checkout. The purchase is not complete until the signed Razorpay webhook arrives.
          </p>
        </div>
        <div className="paymentPendingActions">
          {(paymentLink||session.paymentLinkUrl) && <a
            className="button buttonPrimary"
            href={paymentLink||session.paymentLinkUrl||"#"}
            target="_blank"
            rel="noreferrer"
          >
            Open Razorpay
          </a>}
          <button className="button buttonSecondary" onClick={refreshSession}>
            Refresh Status
          </button>
        </div>
      </article>}

      {session.status==="CAPTURED" && <article className="capturedProofCard">
        <div>
          <span className="miniLabel">VERIFIED PURCHASE</span>
          <h2>PAYMENT CAPTURED</h2>
          <p>
            Razorpay webhook verified · wallet authority debited once · tamper-evident proof generated.
          </p>
        </div>
        <div className="capturedActions">
          <strong>
            ₹{Number(session.capturedAmount??session.selectedProduct.price).toLocaleString("en-IN")}
          </strong>
          <a
            className="button buttonPrimary"
            href={`/proof/${encodeURIComponent(session.sessionId)}`}
          >
            View Proof Receipt
          </a>
        </div>
      </article>}

      {session.status==="REJECTED" && <article className="sessionRejected">
        <strong>TRANSACTION REJECTED</strong>
        <span>Human step-up consent was denied. Money movement remains disabled.</span>
      </article>}
    </section>}
  </div></Shell>;
}

function Authority({label,value}:{label:string;value:string}){
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
function State({label,value}:{label:string;value:string}){
  return <div className="sessionStateRow"><span>{label}</span><strong>{value}</strong></div>;
}
function EventDetails({event}:{event:Event}){
  const p=event.payload;
  if(event.eventType==="PRODUCT_FOUND")
    return <p>{String(p.merchant)} found {String(p.title)} at ₹{Number(p.price).toLocaleString("en-IN")}</p>;
  if(event.eventType==="POLICY_DECISION")
    return <p>{String(p.title)} → <strong>{String(p.decision)}</strong>
      {Array.isArray(p.violations)&&p.violations.length?` · ${(p.violations as string[]).join(" · ")}`:""}</p>;
  if(event.eventType==="MERCHANT_TEXT_OBSERVED")
    return <p><strong>UNTRUSTED merchant text isolated from authorization.</strong></p>;
  if(event.eventType==="CANDIDATE_SELECTED")
    return <p>{String(p.title)} · ₹{Number(p.price).toLocaleString("en-IN")} · {String(p.reason)}</p>;
  if(event.eventType==="STEP_UP_REQUIRED")
    return <p>Additional human authority required: ₹{Number(p.additionalAuthorityRequired).toLocaleString("en-IN")}</p>;
  if(event.eventType==="WALLET_ATTACHED")
    return <p>{String(p.walletName)} · auto ≤₹{Number(p.autoBuyLimit).toLocaleString("en-IN")} · hard ≤₹{Number(p.maxSingleTransaction).toLocaleString("en-IN")}</p>;
  if(event.eventType==="USER_INTENT_RECEIVED")
    return <p>{String(p.prompt)}</p>;
  if(event.eventType==="COMMERCE_QUOTE_REVALIDATED")
    return <p>Live Shopify quote revalidated immediately before payment · ₹{Number(p.price).toLocaleString("en-IN")}.</p>;
  if(event.eventType==="COMMERCE_QUOTE_CHANGED")
    return <p>Live commerce facts changed after authorization · payment stopped and re-authorization required.</p>;
  if(event.eventType==="PAYMENT_LINK_CREATED")
    return <p>Razorpay checkout created · ₹{Number(p.amount).toLocaleString("en-IN")} · exact quote bound.</p>;
  if(event.eventType==="ONE_TIME_AUTHORIZATION_CONSUMED")
    return <p>Signed one-time authority consumed for this exact PurchaseSession.</p>;
  if(event.eventType==="RAZORPAY_WEBHOOK_VERIFIED")
    return <p>Razorpay webhook signature verified before processing.</p>;
  if(event.eventType==="PAYMENT_CAPTURED")
    return <p>Payment captured · ₹{Number(p.amount).toLocaleString("en-IN")}.</p>;
  if(event.eventType==="WALLET_SPEND_APPLIED")
    return <p>Wallet debited once · remaining authority ₹{Number(p.remainingAuthority).toLocaleString("en-IN")}.</p>;
  if(event.eventType==="PROOF_RECEIPT_CREATED")
    return <p>Cryptographic Proof Receipt generated · {String(p.receiptId)}.</p>;
  return <p>{pretty(event.eventType)}</p>;
}
