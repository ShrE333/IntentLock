"use client";

import {useEffect,useMemo,useState} from "react";
import {Shell} from "../components/Shell";
import {API} from "../lib";
import styles from "./post-purchase.module.css";

type Session={sessionId:string;status:string;userPrompt:string;capturedAmount:number|null;capturedCurrency:string|null;paymentProvider:string|null;providerCaptureId:string|null;updatedAt:string;};
type Refund={refundId:string;amount:number;currency:string;walletCreditAmount:number;walletCreditCurrency:string;status:string;providerStatus:string|null;providerRefundId:string|null;evidenceHash:string|null;};
type State={session:Session;payment:any;refunds:Refund[];disputes:any[]};
type Evaluation={policy:{decision:"ALLOW"|"BLOCK";violations:string[];reasons:string[];refundableRemaining:number};capture:{amount:number;currency:string;captureId:string};requested:{amount:number;currency:string};walletCredit:{amount:number;currency:string};openDisputes:any[];reason:string;};

async function req<T>(path:string,init?:RequestInit):Promise<T>{
  const r=await fetch(`${API}${path}`,{cache:"no-store",...init});
  const b=await r.json();
  if(!r.ok) throw new Error(b?.message??b?.error??`Request failed (${r.status})`);
  return b as T;
}

export default function PostPurchasePage(){
  const [sessions,setSessions]=useState<Session[]>([]);
  const [sessionId,setSessionId]=useState("");
  const [state,setState]=useState<State|null>(null);
  const [amount,setAmount]=useState("");
  const [reason,setReason]=useState("CUSTOMER_REQUEST");
  const [evaluation,setEvaluation]=useState<Evaluation|null>(null);
  const [opsToken,setOpsToken]=useState("");
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");

  const selected=useMemo(()=>sessions.find(s=>s.sessionId===sessionId)??null,[sessions,sessionId]);

  async function loadSessions(){
    try{
      const r=await req<{sessions:Session[]}>("/api/sessions");
      const captured=r.sessions.filter(s=>s.status==="CAPTURED");
      setSessions(captured);
      if(!sessionId&&captured[0]) setSessionId(captured[0].sessionId);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  }
  async function loadState(id=sessionId){
    if(!id) return;
    setBusy("Loading provider, refund and dispute state…");setError("");
    try{
      const r=await req<State>(`/api/trust-center/post-purchase/${encodeURIComponent(id)}`);
      setState(r);
      if(!amount&&r.payment?.amount) setAmount(String(r.payment.amount));
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }
  useEffect(()=>{loadSessions();},[]);
  useEffect(()=>{if(sessionId) loadState(sessionId);},[sessionId]);

  async function evaluate(){
    if(!sessionId) return;
    setBusy("Running Refund Firewall…");setError("");setEvaluation(null);
    try{
      const r=await req<Evaluation>(`/api/trust-center/refunds/evaluate/${encodeURIComponent(sessionId)}`,{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({amount:Number(amount),reason})
      });
      setEvaluation(r);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  async function requestRefund(){
    if(!sessionId||!opsToken) {setError("Enter the TrustOps admin token to execute a refund.");return;}
    setBusy("Requesting PayPal refund…");setError("");
    try{
      await req(`/api/trust-center/refunds/request/${encodeURIComponent(sessionId)}`,{
        method:"POST",headers:{"content-type":"application/json","x-intentlock-ops-token":opsToken},
        body:JSON.stringify({amount:Number(amount),reason})
      });
      await loadState(sessionId);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  async function sync(refundId:string){
    if(!opsToken){setError("Enter the TrustOps admin token to reconcile a refund.");return;}
    setBusy("Reading PayPal refund truth and reconciling wallet authority…");setError("");
    try{
      await req(`/api/trust-center/refunds/${encodeURIComponent(refundId)}/sync`,{
        method:"POST",headers:{"content-type":"application/json","x-intentlock-ops-token":opsToken}
      });
      await loadState(sessionId);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  return <Shell><div className={styles.page}>
    <header className={styles.header}>
      <span>POST-PURCHASE · REFUND & DISPUTE CONTROL</span>
      <h1>A payment is not finished when capture succeeds.</h1>
      <p>Refunds can double-pay a buyer, restore the wrong budget, collide with disputes, or be replayed. This surface keeps the same transaction under deterministic control after purchase.</p>
    </header>

    {busy&&<div className={styles.notice}>{busy}</div>}
    {error&&<div className={styles.error}>{error}</div>}

    <section className={styles.flow}>
      {[["01","CAPTURE","Verified money movement"],["02","REFUND FIREWALL","Policy before reversal"],["03","PAYPAL","Idempotent refund request"],["04","PROVIDER TRUTH","Authenticated status read"],["05","WALLET CREDIT","Replay-safe authority restore"],["06","DISPUTE GUARD","Prevent double reimbursement"]].map(([n,t,d])=><div key={n}><span>{n}</span><strong>{t}</strong><small>{d}</small></div>)}
    </section>

    <section className={styles.grid}>
      <article className={styles.card}>
        <span className={styles.kicker}>TRANSACTION</span><h2>Select a captured PurchaseSession</h2>
        <select value={sessionId} onChange={e=>{setSessionId(e.target.value);setEvaluation(null);setAmount("");}}>
          <option value="">Select captured session</option>
          {sessions.map(s=><option key={s.sessionId} value={s.sessionId}>{s.sessionId.slice(0,20)}… · {s.capturedCurrency} {s.capturedAmount}</option>)}
        </select>
        {selected&&<div className={styles.sessionBox}><strong>{selected.userPrompt}</strong><span>{selected.paymentProvider?.toUpperCase()} · capture {selected.providerCaptureId??"—"}</span></div>}
      </article>

      <article className={styles.card}>
        <span className={styles.kicker}>REFUND FIREWALL</span><h2>Evaluate before money reverses</h2>
        <div className={styles.formRow}><label><span>Amount</span><input type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label><span>Reason</span><select value={reason} onChange={e=>setReason(e.target.value)}><option value="CUSTOMER_REQUEST">Customer request</option><option value="DUPLICATE_CHARGE">Duplicate charge</option><option value="ITEM_NOT_RECEIVED">Item not received</option><option value="NOT_AS_DESCRIBED">Not as described</option><option value="OTHER">Other</option></select></label></div>
        <button onClick={evaluate}>Evaluate refund</button>
        {evaluation&&<div className={`${styles.decision} ${evaluation.policy.decision==="ALLOW"?styles.allow:styles.block}`}><strong>{evaluation.policy.decision}</strong><span>Remaining refundable: {evaluation.capture.currency} {evaluation.policy.refundableRemaining.toFixed(2)}</span><span>Wallet authority restored if confirmed: {evaluation.walletCredit.currency} {evaluation.walletCredit.amount.toFixed(2)}</span>{[...evaluation.policy.violations,...evaluation.policy.reasons].map(x=><small key={x}>{x}</small>)}</div>}
      </article>
    </section>

    <section className={styles.card}>
      <div className={styles.cardTop}><div><span className={styles.kicker}>EXECUTION</span><h2>Protected refund execution</h2><p>Provider POST success does not restore wallet authority. IntentLock restores it only after an authenticated PayPal refund read confirms COMPLETED.</p></div></div>
      <label className={styles.token}><span>TrustOps admin token (kept only in this page state)</span><input type="password" value={opsToken} onChange={e=>setOpsToken(e.target.value)} placeholder="Required for money-moving actions"/></label>
      <button className={styles.primary} onClick={requestRefund} disabled={evaluation?.policy.decision!=="ALLOW"}>Request approved refund</button>
    </section>

    <section className={styles.card}>
      <div className={styles.cardTop}><div><span className={styles.kicker}>REFUND STATE</span><h2>Refund ledger</h2></div><button onClick={()=>loadState()}>Refresh</button></div>
      {!state?.refunds?.length?<div className={styles.empty}>No refunds for this transaction.</div>:<div className={styles.table}>{state.refunds.map(r=><div className={styles.row} key={r.refundId}><code>{r.refundId.slice(0,16)}…</code><span>{r.currency} {r.amount.toFixed(2)}</span><span>restore {r.walletCreditCurrency} {r.walletCreditAmount.toFixed(2)}</span><strong>{r.status}</strong><button onClick={()=>sync(r.refundId)} disabled={r.status==="COMPLETED"}>Sync provider truth</button></div>)}</div>}
    </section>

    <section className={styles.card}>
      <span className={styles.kicker}>DISPUTE COLLISION GUARD</span><h2>Open PayPal disputes</h2>
      <p className={styles.sub}>By default, an unresolved dispute blocks automatic refund execution so a buyer cannot be reimbursed twice through refund + dispute paths.</p>
      {!state?.disputes?.length?<div className={styles.empty}>No unresolved PayPal dispute returned for this capture.</div>:<div className={styles.disputes}>{state.disputes.map((d:any)=><div key={d.dispute_id}><strong>{d.dispute_id}</strong><span>{d.status} · {d.reason}</span></div>)}</div>}
    </section>
  </div></Shell>;
}
