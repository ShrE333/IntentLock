"use client";
import {financialFetch} from '../demo-access';


import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {Shell} from "../components/Shell";
import {requireApiUrl} from "../lib";
import styles from "./trust-center.module.css";

type Overview={
  version:string;
  reconciliation:{healthy:number;drift:number;stale:number;pending:number;closed:number};
  payeeLock:{mode:"observe"|"enforce";configured:boolean;trustedPayeeCount:number};
  latestCapturedSessionId:string|null;
};

type Finding={
  sessionId:string;status:string;severity:string;sessionStatus:string;paymentStatus:string|null;
  provider:string|null;providerCaptureId:string|null;ledgerPresent:boolean;proofPresent:boolean;
  providerSnapshot:null|{status:string;amount:number;currency:string};issues:string[];
  pendingReason:string|null;nextStep:string;recommendedAction:string;updatedAt:string;
};

type PayeeLock={
  provider:string;payeeId:string;merchantLabel:string;merchantCountry:string;
  fingerprint:string;mode:string;trustStatus:string;trustedLabel:string|null;
};

type Session={
  sessionId:string;walletId:string;connectorId:string;userPrompt:string;status:string;
  selectedProduct:null|{
    id:string;title:string;brand:string;category:string;merchant:string;merchantCountry?:string;
    price:number;currency:string;features:string[];source?:string;
    authorizationContext?:{
      buyerCountry:string;merchantCountry:string;walletAmount:number;walletCurrency:string;
      presentmentAmount:number;presentmentCurrency:string;fxQuote:any;payeeLock?:PayeeLock|null;
    };
  };
  selectedDecision:string|null;authorizationId:string|null;quoteHash:string|null;
  paymentProvider:string|null;providerOrderId:string|null;providerAuthorizationId:string|null;
  providerCaptureId:string|null;capturedAmount:number|null;capturedCurrency:string|null;
  capturedAt:string|null;proofReceiptId:string|null;createdAt?:string;updatedAt?:string;
};

type Event={eventSeq:number;eventId:string;eventType:string;payload:Record<string,unknown>;occurredAt:string};
type Payment={provider:string;providerOrderId:string|null;providerAuthorizationId:string|null;providerCaptureId:string|null;amount:number;currency:string;status:string;capturedAt?:string|null};
type ProofResponse={receipt:any;verification:{verified:boolean;auditChainValid:boolean;checkedEvents:number;currentAuditHeadHash:string|null}};
type Journey={session:Session;events:Event[];payment:Payment|null;proof:ProofResponse|null};

type Evidence={
  reason:string;packetHash:string;submissionReadiness:string;
  evidenceCoverage:{available:number;total:number;completeness:number;requirements:Array<{label:string;available:boolean;evidence:string|null}>};
  session:{sessionId:string;status:string;userPrompt:string};
  authorization:any;product:any;payment:any;walletLedger:any;proof:any;note:string;
};

async function request<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await financialFetch(`${requireApiUrl()}${path}`,{cache:"no-store",...init});
  const body=await response.json();
  if(!response.ok) throw new Error(body?.message??body?.error??`Request failed (${response.status})`);
  return body as T;
}

async function optionalRequest<T>(path:string):Promise<T|null>{
  try{
    const response=await financialFetch(`${requireApiUrl()}${path}`,{cache:"no-store"});
    if(!response.ok) return null;
    return await response.json() as T;
  }catch{return null;}
}

const money=(amount:number|null|undefined,currency:string|null|undefined)=>{
  if(amount==null) return "—";
  const c=String(currency??"").toUpperCase();
  try{return new Intl.NumberFormat("en-US",{style:"currency",currency:c||"USD"}).format(amount);}catch{return `${c} ${amount.toFixed(2)}`;}
};

export default function TrustCenterPage(){
  const [overview,setOverview]=useState<Overview|null>(null);
  const [findings,setFindings]=useState<Finding[]>([]);
  const [deep,setDeep]=useState(false);
  const [selectedId,setSelectedId]=useState("");
  const [journey,setJourney]=useState<Journey|null>(null);
  const [reason,setReason]=useState("UNAUTHORIZED_TRANSACTION");
  const [evidence,setEvidence]=useState<Evidence|null>(null);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");

  async function loadOverview(){
    const data=await request<Overview>("/api/trust-center/overview");
    setOverview(data);
    return data;
  }

  async function scan(providerDeep=false){
    setBusy(providerDeep?"Checking PayPal and IntentLock state for recent transactions…":"Checking IntentLock financial state…");
    setError("");
    try{
      const data=await request<{findings:Finding[]}>(`/api/trust-center/reconciliation${providerDeep?"?deep=1":""}`);
      setFindings(data.findings);setDeep(providerDeep);
      await loadOverview();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  async function loadJourney(id:string){
    if(!id) return;
    setBusy("Loading the complete transaction lifecycle…");setError("");setEvidence(null);
    try{
      const [sessionData,paymentData,proofData]=await Promise.all([
        request<{session:Session;events:Event[]}>(`/api/sessions/${encodeURIComponent(id)}`),
        optionalRequest<{payment:Payment|null}>(`/api/sessions/${encodeURIComponent(id)}/payment`),
        optionalRequest<ProofResponse>(`/api/sessions/${encodeURIComponent(id)}/proof`)
      ]);
      setJourney({session:sessionData.session,events:sessionData.events,payment:paymentData?.payment??null,proof:proofData});
      if(typeof window!=="undefined"){
        const url=new URL(window.location.href);url.searchParams.set("sessionId",id);window.history.replaceState({},"",url.toString());
      }
    }catch(e){setError(e instanceof Error?e.message:String(e));setJourney(null);}
    finally{setBusy("");}
  }

  useEffect(()=>{scan(false);},[]);

  useEffect(()=>{
    if(selectedId||(!overview&&!findings.length)) return;
    let fromUrl="";
    if(typeof window!=="undefined") fromUrl=new URLSearchParams(window.location.search).get("sessionId")??"";
    const candidate=fromUrl||overview?.latestCapturedSessionId||findings[0]?.sessionId||"";
    if(candidate) setSelectedId(candidate);
  },[overview,findings,selectedId]);

  useEffect(()=>{if(selectedId) loadJourney(selectedId);},[selectedId]);

  async function generateEvidence(){
    if(!selectedId){setError("Select a transaction first.");return;}
    setBusy("Reconstructing dispute evidence from this same transaction…");setError("");setEvidence(null);
    try{
      const data=await request<{evidence:Evidence}>(`/api/trust-center/disputes/evidence/${encodeURIComponent(selectedId)}?reason=${encodeURIComponent(reason)}`);
      setEvidence(data.evidence);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  function downloadEvidence(){
    if(!evidence) return;
    const blob=new Blob([JSON.stringify(evidence,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=url;a.download=`intentlock-dispute-${evidence.session.sessionId}.json`;a.click();URL.revokeObjectURL(url);
  }

  const finding=useMemo(()=>findings.find(f=>f.sessionId===selectedId)??null,[findings,selectedId]);
  const counts=overview?.reconciliation;
  const session=journey?.session??null;
  const product=session?.selectedProduct??null;
  const context=product?.authorizationContext??null;
  const payee=context?.payeeLock??null;
  const eventTypes=useMemo(()=>new Set((journey?.events??[]).map(e=>e.eventType)),[journey]);
  const stages=buildStages(session,journey?.payment??null,journey?.proof??null,finding,eventTypes,payee);
  const completedStages=stages.filter(s=>s.state==="done").length;

  return <Shell><div className={styles.page}>
    <section className={styles.hero}>
      <div>
        <span className={styles.kicker}>TRANSACTION CONTROL · END TO END</span>
        <h1>Do not inspect features. <span>Follow the money.</span></h1>
        <p>Choose one PurchaseSession and IntentLock shows the same transaction from the original user request, through commerce and authorization, into PayPal, verified settlement, ledger, proof, reconciliation and dispute evidence.</p>
      </div>
      <div className={styles.heroSummary}>
        <span>WHY THIS PAGE EXISTS</span>
        <strong>Every module below is attached to the same transaction.</strong>
        <p>No separate PayeeLock demo. No separate reconciliation demo. No separate dispute demo.</p>
      </div>
    </section>

    <section className={styles.selectorBar}>
      <div>
        <span className={styles.micro}>TRANSACTION TO FOLLOW</span>
        <select value={selectedId} onChange={e=>setSelectedId(e.target.value)}>
          {!findings.length&&<option value="">No sessions found</option>}
          {findings.map(f=><option key={f.sessionId} value={f.sessionId}>{f.sessionId.slice(0,22)} · {f.sessionStatus} · {f.provider?.toUpperCase()??"NO PAYMENT"}</option>)}
        </select>
      </div>
      <div className={styles.selectorActions}>
        <Link href="/new-purchase">Start a new transaction</Link>
        {session?.proofReceiptId&&<Link href={`/proof/${encodeURIComponent(session.sessionId)}`}>Open proof receipt</Link>}
      </div>
    </section>

    {busy&&<div className={styles.notice}>{busy}</div>}
    {error&&<div className={styles.error}>{error}</div>}

    {session&&<>
      <section className={styles.transactionHeader}>
        <div className={styles.transactionMain}>
          <span className={styles.micro}>ORIGINAL USER INTENT</span>
          <h2>“{session.userPrompt}”</h2>
          <div className={styles.transactionMeta}>
            <span>{session.connectorId}</span>
            <span>{session.selectedDecision??"NO DECISION"}</span>
            <span>{session.paymentProvider?.toUpperCase()??"NO RAIL"}</span>
            <span>{finding?.status??session.status}</span>
          </div>
        </div>
        <div className={styles.transactionProduct}>
          <span className={styles.micro}>SELECTED TRANSACTION</span>
          <strong>{product?.title??"No product selected"}</strong>
          <p>{product?`${product.merchant} · ${money(product.price,product.currency)}`:"The session never reached product selection."}</p>
          <small>{completedStages}/{stages.length} lifecycle checkpoints complete</small>
        </div>
      </section>

      <section className={styles.pipelineSection}>
        <div className={styles.sectionHeader}>
          <div><span className={styles.micro}>THE COMPLETE PIPELINE</span><h2>What happened to this transaction?</h2><p>Read left to right. Each checkpoint exists because the previous one is not enough to trust money movement.</p></div>
        </div>
        <div className={styles.pipeline}>
          {stages.map((stage,index)=><article key={stage.id} className={`${styles.stage} ${styles[`stage_${stage.state}`]}`}>
            <div className={styles.stageTop}><span>{stage.id}</span><StateBadge state={stage.state}/></div>
            <strong>{stage.title}</strong>
            <p>{stage.description}</p>
            <small>{stage.evidence}</small>
            {index<stages.length-1&&<i className={styles.stageArrow}>→</i>}
          </article>)}
        </div>
      </section>

      <section className={styles.sameTransactionGrid}>
        <article className={styles.panel}>
          <span className={styles.micro}>CHECKPOINT 03 · PAYEE IDENTITY</span>
          <h2>Who was actually authorized to receive money?</h2>
          {payee?<div className={styles.payeeBound}>
            <div><span>Merchant</span><strong>{payee.merchantLabel}</strong></div>
            <div><span>Provider / payee ID</span><strong>{payee.provider} · {payee.payeeId}</strong></div>
            <div><span>Country</span><strong>{payee.merchantCountry}</strong></div>
            <div className={styles.hashRow}><span>Bound fingerprint</span><code>{payee.fingerprint}</code></div>
            <p>If the structured seller identity changes during revalidation, this authorization cannot be reused.</p>
          </div>:<LegacyNote text="This PurchaseSession was created before PayeeLock was added, so it has no payee fingerprint. New TRUST CENTER+ sessions bind seller identity automatically. The UI does not pretend legacy evidence exists."/>}
        </article>

        <article className={styles.panel}>
          <span className={styles.micro}>CHECKPOINT 07–09 · FINANCIAL TRUTH</span>
          <h2>Did provider, ledger and proof converge?</h2>
          <div className={styles.truthGrid}>
            <Truth label="Session" value={session.status} ok={session.status==="CAPTURED"}/>
            <Truth label="Payment" value={journey?.payment?.status??"NO PAYMENT"} ok={journey?.payment?.status==="COMPLETED"}/>
            <Truth label="Wallet ledger" value={finding?.ledgerPresent?"DEBITED ONCE":"MISSING"} ok={Boolean(finding?.ledgerPresent)}/>
            <Truth label="Proof receipt" value={journey?.proof?.verification.verified?"VERIFIED":finding?.proofPresent?"UNVERIFIED":"MISSING"} ok={Boolean(journey?.proof?.verification.verified)}/>
            <Truth label="Audit chain" value={journey?.proof?.verification.auditChainValid?"VALID":journey?.proof?"INVALID":"NOT AVAILABLE"} ok={Boolean(journey?.proof?.verification.auditChainValid)}/>
            <Truth label="Watchdog" value={finding?.status??"NOT SCANNED"} ok={finding?.status==="HEALTHY"}/>
          </div>
          {finding?.issues?.length?<div className={styles.issueBox}><strong>Why TrustOps is concerned</strong>{finding.issues.map(x=><span key={x}>{x.replaceAll("_"," ")}</span>)}<span><b>Next:</b> {finding.nextStep}</span><Link href={`/new-purchase?sessionId=${encodeURIComponent(session.sessionId)}`}>Resume this PurchaseSession →</Link></div>:finding?.pendingReason?<div className={styles.issueBox}><strong>This is pending for a specific reason</strong><span>{finding.pendingReason.replaceAll("_"," ")}</span><span><b>Next:</b> {finding.nextStep}</span><Link href={`/new-purchase?sessionId=${encodeURIComponent(session.sessionId)}`}>Resume this PurchaseSession →</Link></div>:<div className={styles.healthyBox}>No state mismatch is currently detected for this transaction.</div>}
        </article>

        <article className={styles.panel}>
          <span className={styles.micro}>CHECKPOINT 10 · DISPUTE READINESS</span>
          <h2>If this payment is challenged, what can we prove?</h2>
          <p className={styles.panelLead}>The evidence engine starts from this exact PurchaseSession. It does not ask you to paste another session ID or create a disconnected demo.</p>
          <label className={styles.reasonField}><span>Dispute scenario</span><select value={reason} onChange={e=>setReason(e.target.value)}><option value="UNAUTHORIZED_TRANSACTION">Unauthorized transaction</option><option value="ITEM_NOT_RECEIVED">Item not received</option><option value="NOT_AS_DESCRIBED">Not as described</option><option value="DUPLICATE_CHARGE">Duplicate charge</option></select></label>
          <button className={styles.primaryButton} onClick={generateEvidence}>Build evidence from this transaction</button>
          {evidence&&<div className={styles.evidence}>
            <div className={styles.evidenceTop}><div><span>Evidence completeness</span><strong>{evidence.evidenceCoverage.completeness}%</strong></div><button onClick={downloadEvidence}>Download JSON</button></div>
            <div className={styles.progress}><i style={{width:`${evidence.evidenceCoverage.completeness}%`}}/></div>
            <div className={styles.requirements}>{evidence.evidenceCoverage.requirements.map(r=><div key={r.label}><b className={r.available?styles.ok:styles.missing}>{r.available?"✓":"!"}</b><span>{r.label}</span></div>)}</div>
            <div className={styles.packetHash}><span>Packet hash</span><code>{evidence.packetHash}</code></div>
          </div>}
        </article>
      </section>

      <section className={styles.tracePanel}>
        <div className={styles.sectionHeader}><div><span className={styles.micro}>RAW SESSION TRACE</span><h2>The events behind the visual pipeline</h2><p>This is the audit-friendly version of the same story above.</p></div><span>{journey?.events.length??0} EVENTS</span></div>
        <div className={styles.traceList}>{(journey?.events??[]).map(e=><div className={styles.traceRow} key={e.eventId}><span>{String(e.eventSeq).padStart(2,"0")}</span><strong>{friendlyEvent(e.eventType)}</strong><p>{eventSummary(e)}</p><time>{new Date(e.occurredAt).toLocaleTimeString()}</time></div>)}</div>
      </section>
    </>}

    <section className={styles.watchdogPanel}>
      <div className={styles.sectionHeader}>
        <div><span className={styles.micro}>FLEET VIEW · AFTER YOU UNDERSTAND ONE TRANSACTION</span><h2>Reconciliation Watchdog</h2><p>Now zoom out. This table applies the same checks across recent PurchaseSessions.</p></div>
        <div className={styles.scanActions}><button onClick={()=>scan(false)}>Internal scan</button><button className={styles.primaryButton} onClick={()=>scan(true)}>Deep PayPal scan</button></div>
      </div>
      <div className={styles.watchTable}>
        <div className={`${styles.watchRow} ${styles.watchHeader}`}><span>Session</span><span>Session / payment</span><span>Ledger / proof</span><span>Provider</span><span>Health</span><span></span></div>
        {findings.slice(0,12).map(f=><div className={`${styles.watchRow} ${f.sessionId===selectedId?styles.selectedRow:""}`} key={f.sessionId}>
          <code>{f.sessionId.slice(0,18)}…</code>
          <span><strong>{f.sessionStatus}</strong><small>{f.paymentStatus??"no payment"}</small></span>
          <span><strong>{f.ledgerPresent?"ledger ✓":"ledger —"}</strong><small>{f.proofPresent?"proof ✓":"proof —"}</small></span>
          <span><strong>{f.provider?.toUpperCase()??"—"}</strong><small>{f.providerSnapshot?.status??(deep?"not checked":"internal only")}</small></span>
          <Status value={f.status}/>
          <button className={styles.inspectButton} onClick={()=>setSelectedId(f.sessionId)}>{f.sessionId===selectedId?"Viewing":"Inspect"}</button>
        </div>)}
      </div>
    </section>

    <section className={styles.bottomStatement}>
      <span>THE POINT OF TRUST CENTER</span>
      <h2>It is not another dashboard. It is the second half of the same payment pipeline.</h2>
      <p>Before payment: authority + payee + quote. During payment: revalidate + execute. After payment: webhook + ledger + proof + reconciliation + dispute evidence.</p>
    </section>
  </div></Shell>;
}

function buildStages(session:Session|null,payment:Payment|null,proof:ProofResponse|null,finding:Finding|null,eventTypes:Set<string>,payee:PayeeLock|null){
  const status=session?.status??"";
  const product=Boolean(session?.selectedProduct);
  const policy=Boolean(session?.selectedDecision);
  const order=Boolean(payment?.providerOrderId||session?.providerOrderId);
  const authorized=Boolean(payment?.providerAuthorizationId||session?.providerAuthorizationId||["AUTHORIZED","CAPTURE_PENDING","CAPTURED"].includes(status));
  const verified=Boolean(proof?.verification.verified);
  const blocked=status==="BLOCKED"||status==="REJECTED";
  return [
    {id:"01",title:"Intent",state:session?"done":"waiting",description:"The user gives the agent a goal under an Intent Wallet.",evidence:session?.userPrompt??"No session"},
    {id:"02",title:"Commerce",state:product?"done":blocked?"blocked":eventTypes.has("SEARCH_STARTED")?"current":"waiting",description:"The agent searches products. Merchant prose remains untrusted.",evidence:product?session?.selectedProduct?.title??"Product selected":"No product selected"},
    {id:"03",title:"PayeeLock",state:payee?"done":product?"legacy":"waiting",description:"Structured seller identity is bound to authorization.",evidence:payee?`${payee.provider} · ${payee.payeeId}`:product?"Legacy session — no payee binding":"Waiting for product"},
    {id:"04",title:"Authority",state:policy?(session?.selectedDecision==="BLOCK"?"blocked":"done"):"waiting",description:"Deterministic policy returns ALLOW, STEP-UP or BLOCK.",evidence:session?.selectedDecision??"No decision"},
    {id:"05",title:"Provider order",state:order?"done":status==="READY_TO_PAY"?"current":blocked?"blocked":"waiting",description:"A payment order is created only after authority passes.",evidence:payment?.providerOrderId??session?.providerOrderId??"No provider order"},
    {id:"06",title:"Authorize + capture",state:verified?"done":authorized?"current":order?"current":"waiting",description:"Quote, payee and policy are revalidated before capture; provider success alone is not trusted.",evidence:verified?"Verified capture evidence":authorized?"Authorization/capture in progress":"Not reached"},
    {id:"07",title:"Wallet ledger",state:finding?.ledgerPresent?"done":verified?"current":"waiting",description:"Wallet authority is debited exactly once after verified settlement evidence.",evidence:finding?.ledgerPresent?"Replay-safe ledger present":"No ledger yet"},
    {id:"08",title:"Proof",state:proof?.verification.verified?"done":finding?.ledgerPresent?"current":"waiting",description:"The transaction becomes a signed proof receipt backed by the audit chain.",evidence:session?.proofReceiptId??(finding?.proofPresent?"Proof present":"No proof yet")},
    {id:"09",title:"TrustOps",state:finding?.status==="HEALTHY"?"done":finding?.status==="DRIFT"||finding?.status==="STALE_PENDING"?"current":finding?"current":"waiting",description:"Provider, session, ledger and proof are checked for drift and dispute readiness.",evidence:finding?.status??"Not scanned"},
  ] as Array<{id:string;title:string;state:"done"|"current"|"waiting"|"blocked"|"legacy";description:string;evidence:string}>;
}

function StateBadge({state}:{state:string}){const label=state==="done"?"COMPLETE":state==="current"?"IN PROGRESS":state==="blocked"?"STOPPED":state==="legacy"?"LEGACY":"WAITING";return <b>{label}</b>;}
function Truth({label,value,ok}:{label:string;value:string;ok:boolean}){return <div className={ok?styles.truthOk:styles.truthWait}><span>{label}</span><strong>{value}</strong></div>;}
function LegacyNote({text}:{text:string}){return <div className={styles.legacyNote}><strong>Legacy transaction</strong><p>{text}</p></div>;}
function Status({value}:{value:string}){const v=value.toUpperCase();const cls=v.includes("HEALTHY")?styles.statusGood:v.includes("DRIFT")?styles.statusBad:v.includes("STALE")?styles.statusWarn:styles.statusNeutral;return <span className={`${styles.status} ${cls}`}>{value.replaceAll("_"," ")}</span>;}
function friendlyEvent(value:string){return value.replaceAll("_"," ").toLowerCase().replace(/(^|\s)\S/g,x=>x.toUpperCase());}
function eventSummary(event:Event){
  const p=event.payload;
  if(event.eventType==="PRODUCT_FOUND") return `${String(p.merchant??"Merchant")} · ${String(p.title??"Product")} · ${String(p.currency??"")} ${String(p.price??"")}`;
  if(event.eventType==="POLICY_DECISION") return `${String(p.decision??"")} · wallet ${String(p.walletCurrency??"")} ${String(p.walletAmount??"")}`;
  if(event.eventType==="FX_QUOTE_BOUND") return `${String(p.presentmentCurrency??"")} ${String(p.presentmentAmount??"")} → ${String(p.walletCurrency??"")} ${String(p.walletAmount??"")}`;
  if(event.eventType.includes("WEBHOOK_VERIFIED")) return "Provider signature verified before trusted settlement.";
  if(event.eventType==="WALLET_SPEND_APPLIED") return "Wallet ledger debit applied exactly once.";
  if(event.eventType==="PROOF_RECEIPT_CREATED") return "Cryptographic proof receipt attached to the session.";
  if(event.eventType==="PAYMENT_RAIL_SELECTED") return `${String(p.provider??"").toUpperCase()} selected for the bound payment context.`;
  return "Recorded in the PurchaseSession audit trail.";
}
