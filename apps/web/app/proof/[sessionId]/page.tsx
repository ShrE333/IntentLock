"use client";

import {useEffect,useState,type ReactNode} from "react";
import Link from "next/link";
import {useParams} from "next/navigation";
import {Shell} from "../../components/Shell";
import {getJson} from "../../lib";
import "./receipt.css";

type ProofResponse={
  receipt:{receiptId:string;sessionId:string;walletId:string;proofHash:string;proofSignature:string;evidenceAuditHeadHash:string|null;payload:any;createdAt:string;};
  verification:{verified:boolean;integrityVerified?:boolean;recipientVerified?:boolean;payloadHashValid:boolean;signatureValid:boolean;evidenceHeadValid:boolean;auditChainValid:boolean;checkedEvents:number;currentAuditHeadHash:string|null;evidenceAuditHeadHash:string|null;proofHash:string;signaturePresent:boolean;};
};
const money=(n:number,currency?:string|null)=>{
  const code=String(currency??"").trim().toUpperCase();
  const amount=Number.isFinite(Number(n))?Number(n):0;
  const zeroDecimal=["JPY","HUF","TWD"].includes(code);
  const digits=zeroDecimal?0:2;

  // Legacy/incomplete rows must never crash the entire page.
  if(!/^[A-Z]{3}$/.test(code)){
    return `${code||"CUR"} ${amount.toLocaleString("en-US",{
      minimumFractionDigits:digits,maximumFractionDigits:digits
    })}`;
  }

  try{
    return new Intl.NumberFormat("en-US",{
      style:"currency",currency:code,
      minimumFractionDigits:digits,maximumFractionDigits:digits
    }).format(amount);
  }catch{
    return `${code} ${amount.toLocaleString("en-US",{
      minimumFractionDigits:digits,maximumFractionDigits:digits
    })}`;
  }
};
const present=(v:unknown)=>v!==null&&v!==undefined&&String(v).trim()!=="";
const text=(v:unknown)=>present(v)?String(v):"—";
const moneyOr=(n:unknown,currency?:string|null)=>present(n)&&Number.isFinite(Number(n))?money(Number(n),currency):"—";
const when=(v:unknown)=>{
  if(!present(v))return "—";
  const d=new Date(String(v));
  return Number.isNaN(d.getTime())?String(v):d.toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short"});
};
const middle=(v:string,head=10,tail=8)=>v.length>head+tail+3?`${v.slice(0,head)}…${v.slice(-tail)}`:v;
const modeLabel=(m:unknown)=>m==="SIGNED_ONE_TIME_AUTHORIZATION"?"One-time approval":m==="INTENT_WALLET_POLICY_AT_EXECUTION"?"Autonomous (wallet policy)":text(m);
const sourceLabel=(s:unknown)=>s==="VERIFIED_PROVIDER_WEBHOOK"?"Settled from PayPal's signed webhook":text(s);

export default function ProofReceiptPage(){
  const params=useParams<{sessionId:string}>();
  const sessionId=decodeURIComponent(String(params.sessionId??""));
  const [data,setData]=useState<ProofResponse|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(true);
  const [evidenceOpen,setEvidenceOpen]=useState(false);

  useEffect(()=>{if(!sessionId)return;(async()=>{try{setData(await getJson<ProofResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/proof`));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}})();},[sessionId]);

  // Print shows every disclosure expanded, then restores the reader's choice.
  useEffect(()=>{
    let previous=false;
    const before=()=>{setEvidenceOpen(o=>{previous=o;return true;});};
    const after=()=>setEvidenceOpen(previous);
    window.addEventListener("beforeprint",before);window.addEventListener("afterprint",after);
    return()=>{window.removeEventListener("beforeprint",before);window.removeEventListener("afterprint",after);};
  },[]);

  const p=data?.receipt.payload;
  const provider=String(p?.payment?.provider??"payment").toUpperCase();
  const providerName=provider==="PAYPAL"?"PayPal":provider;
  const paymentCurrency=String(p?.payment?.currency??"USD");
  const walletCurrency=String(p?.wallet?.currency??p?.walletSpend?.currency??paymentCurrency);
  const fx=p?.paymentContext?.fxQuote;
  const fullyVerified=data?.verification.verified===true&&(p?.payment?.provider!=='paypal'||data?.verification.recipientVerified===true);

  function download(){
    if(!data)return;
    try{
      const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=`receipt-${data.receipt.receiptId}.json`;
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{/* download unavailable */}
  }

  // Checks: every ok-condition is the original, verbatim; only grouping and labels changed.
  const groups:{title:string;items:{ok:boolean;label:string}[]}[]=data?[
    {title:"Authority & quote",items:[
      {ok:data.verification.integrityVerified===true,label:"Intent Wallet authority recorded"},
      {ok:data.verification.integrityVerified===true,label:"Merchant amount + wallet amount bound"},
      {ok:data.verification.integrityVerified===true&&(!p.paymentContext?.fxBound||Boolean(fx?.quoteId)),label:"FX quote bound when currencies differ"},
      {ok:data.verification.integrityVerified===true&&Boolean(p.walletSpend?.ledgerId),label:"Wallet spend ledger applied once"},
    ]},
    {title:"PayPal evidence",items:[
      {ok:data.verification.integrityVerified===true&&Boolean(p.payment?.webhookSignatureVerified),label:"Provider webhook signature verified"},
      ...(p.payment?.provider==='paypal'?[{ok:data.verification.recipientVerified===true,label:"Receiving merchant verified"}]:[]),
    ]},
    {title:"Integrity",items:[
      {ok:data.verification.auditChainValid,label:"Tamper-evident audit chain valid"},
      {ok:data.verification.signatureValid,label:"Proof receipt signed"},
    ]},
  ]:[];
  const allChecks=groups.flatMap(g=>g.items);
  const passed=allChecks.filter(c=>c.ok).length;

  const crossCurrency=Boolean(p?.paymentContext?.fxBound)||
    String(p?.paymentContext?.presentmentCurrency??paymentCurrency).toUpperCase()!==String(p?.paymentContext?.walletCurrency??walletCurrency).toUpperCase();
  const sandbox=Boolean(p?.recipientVerification?.sandbox);
  const verdict=fullyVerified?(sandbox?"Verified sandbox payment":"Verified payment evidence"):"Not fully verified";

  return <Shell><div className="rc-root">
    {!data&&<h1 className="rc-pagetitle">Proof receipt</h1>}
    {busy&&<div className="rc-state" role="status"><span className="rc-spinner" aria-hidden="true"/><div><strong>Loading proof receipt</strong><p>Fetching the signed receipt and re-checking its audit chain…</p></div></div>}
    {error&&<div className="rc-state rc-state-error" role="alert"><span className="rc-mark" aria-hidden="true">!</span><div><strong>Receipt unavailable</strong><p>{error}</p></div></div>}
    {data&&<article className="rc-receipt" aria-label="Proof receipt">
      <header className={`rc-head ${fullyVerified?"is-ok":"is-bad"}`}>
        <div className="rc-verdict"><span className="rc-seal" aria-hidden="true">{fullyVerified?"✓":"✕"}</span><div><span className="rc-eyebrow">Proof receipt</span><h1>{verdict}</h1></div></div>
        <div className="rc-amount"><span className="rc-label">Amount paid</span><strong>{moneyOr(p.payment?.amount,paymentCurrency)}</strong></div>
        <dl className="rc-summary">
          <div><dt>Product</dt><dd>{text(p.product?.title)}</dd></div>
          <div><dt>Merchant</dt><dd>{text(p.product?.merchant)}</dd></div>
          <div><dt>Settled</dt><dd>{when(data.receipt.createdAt)}</dd></div>
        </dl>
        <div className="rc-ids"><IdChip label="Receipt" value={data.receipt.receiptId}/><IdChip label="Session" value={data.receipt.sessionId||sessionId}/></div>
        <div className="rc-notes"><p>Payment evidence only — not proof of merchant fulfillment.</p>{sandbox&&<p><span className="rc-tag">PayPal Sandbox · test funds</span></p>}</div>
      </header>

      <section className="rc-checks" aria-labelledby="rc-checks-h">
        <div className="rc-section-head"><h2 id="rc-checks-h">Verification</h2><span className={`rc-count ${passed===allChecks.length?"is-ok":"is-bad"}`}>{passed} of {allChecks.length} checks passed</span></div>
        <div className="rc-check-groups">{groups.map(g=><div key={g.title} className="rc-check-group"><h3>{g.title}</h3><ul>{g.items.map(c=><li key={c.label} className={c.ok?"ok":"bad"}><span className="rc-tick" aria-hidden="true">{c.ok?"✓":"✕"}</span><span>{c.label}<span className="rc-sr">{c.ok?" — passed":" — failed"}</span></span></li>)}</ul></div>)}</div>
      </section>

      <div className="rc-columns">
        <Section title="Purchase" n="01">
          <Row label="Product" value={text(p.product?.title)}/>
          <Row label="Merchant" value={`${text(p.product?.merchant)} · ${text(p.paymentContext?.merchantCountry??p.product?.merchantCountry)}`}/>
          <Row label="Buyer country" value={text(p.paymentContext?.buyerCountry??p.wallet?.countryCode)}/>
          <Row label="Checkout amount" value={moneyOr(p.payment?.amount,paymentCurrency)}/>
        </Section>

        <Section title="Authority" n="02">
          <Row label="Wallet" value={`${text(p.wallet?.name)} · ${text(p.wallet?.countryCode)}`}/>
          <Row label="Policy decision" value={text(p.authorization?.policyDecision)}/>
          <Row label="Mode" value={modeLabel(p.authorization?.mode)}/>
          <Row label="Exact quote bound" value={p.authorization?.exactQuoteBound?"Yes":"No"}/>
          <Row label="Wallet debit" value={moneyOr(p.walletSpend?.amount,walletCurrency)}/>
          <Row label="Remaining authority" value={moneyOr(p.wallet?.remainingAuthority,walletCurrency)}/>
          <Row label="Ledger replay-safe" value={p.walletSpend?p.walletSpend.replaySafe?"Yes":"No":"—"}/>
        </Section>

        <Section title={`Payment (${providerName})`} n="03" wide>
          <div className="rc-split">
            <div>
              <Row label="Provider" value={providerName}/>
              <Row label="Status" value={text(p.payment?.status)}/>
              <Row label="Captured state" value={sourceLabel(p.payment?.capturedStateSource)}/>
              <Row label="Webhook signature" value={p.payment?.webhookSignatureVerified?"Verified":"Not verified"}/>
              <Row label="Order" value={<Mono value={p.payment?.providerOrderId}/>}/>
              <Row label="Authorization" value={<Mono value={p.payment?.providerAuthorizationId}/>}/>
              <Row label="Capture / payment" value={<Mono value={p.payment?.providerCaptureId}/>}/>
            </div>
            <div>
              <h3 className="rc-sub">Payment recipient</h3>
              <Row label="Expected merchant" value={text(p.recipientVerification?.expected?.paypalMerchantId??"Not bound in this receipt")}/>
              <Row label="Provider recipient" value={data.verification.recipientVerified?text(p.recipientVerification?.actualMerchantId):"Unverified"}/>
              <Row label="Environment" value={text(p.recipientVerification?.environment??"Historical / unknown")}/>
            </div>
          </div>
        </Section>

        <Section title="FX / quote binding" n="04" wide muted={!crossCurrency}>
          {crossCurrency?<>
            <Row label="Presentment" value={moneyOr(p.paymentContext?.presentmentAmount??p.payment?.amount,String(p.paymentContext?.presentmentCurrency??paymentCurrency))}/>
            <Row label="Wallet authority cost" value={moneyOr(p.paymentContext?.walletAmount??p.walletSpend?.amount,String(p.paymentContext?.walletCurrency??walletCurrency))}/>
            <Row label="FX source" value={text(fx?.source)}/>
            <Row label="FX quote ID" value={<Mono value={fx?.quoteId}/>}/>
            <Row label="FX rate" value={fx?`1 ${text(fx.fromCurrency)} = ${Number.isFinite(Number(fx.rate))?Number(fx.rate).toFixed(6):"—"} ${text(fx.toCurrency)}`:"—"}/>
            <Row label="FX quote expires" value={when(fx?.expiresAt)}/>
          </>:<p className="rc-muted">Same currency — no FX conversion</p>}
        </Section>
      </div>

      <details className="rc-evidence" open={evidenceOpen} onToggle={e=>setEvidenceOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary><span>Cryptographic evidence</span><small>Hashes, signature and audit head</small></summary>
        <div className="rc-evidence-body">
          <Hash label="Quote SHA-256" value={p.authorization?.quoteHash}/>
          <Hash label="Proof SHA-256" value={data.receipt.proofHash}/>
          <Hash label="HMAC signature" value={data.receipt.proofSignature}/>
          <Hash label="Evidence audit head" value={data.receipt.evidenceAuditHeadHash}/>
          <Hash label="Audit-chain events checked" value={String(data.verification.checkedEvents)} plain/>
        </div>
      </details>

      <footer className="rc-actions">
        <Link className="rc-btn rc-btn-primary" href={`/trust-center?sessionId=${encodeURIComponent(sessionId)}`}>← Back to transaction control</Link>
        <button type="button" className="rc-btn" onClick={download}>Download receipt JSON</button>
        <button type="button" className="rc-btn" onClick={()=>window.print()}>Print receipt</button>
      </footer>
    </article>}
  </div></Shell>;
}

function copy(value:string){try{void navigator.clipboard?.writeText(value)?.catch(()=>{});}catch{/* ignore */}}
function CopyBtn({value,label}:{value:string;label:string}){
  const [done,setDone]=useState(false);
  return <button type="button" className="rc-copy" aria-label={`Copy ${label}`} onClick={()=>{copy(value);setDone(true);setTimeout(()=>setDone(false),1400);}}>{done?"Copied":"Copy"}</button>;
}
function IdChip({label,value}:{label:string;value:string}){
  return <div className="rc-chip"><span>{label} ID</span><code title={value}>{middle(String(value??""),12,6)}</code>{present(value)&&<CopyBtn value={value} label={`${label} ID`}/>}</div>;
}
function Mono({value}:{value:unknown}){
  if(!present(value))return <>—</>;
  const v=String(value);
  return <span className="rc-mono"><code title={v}>{middle(v)}</code><CopyBtn value={v} label="value"/></span>;
}
function Section({title,n,children,wide,muted}:{title:string;n:string;children:ReactNode;wide?:boolean;muted?:boolean}){
  return <section className={`rc-section${wide?" rc-wide":""}${muted?" is-muted":""}`}><h2><span>{n}</span>{title}</h2><div>{children}</div></section>;
}
function Row({label,value}:{label:string;value:ReactNode}){return <div className="rc-row"><span>{label}</span><strong>{value}</strong></div>;}
function Hash({label,value,plain}:{label:string;value?:string|null;plain?:boolean}){
  return <div className="rc-hash"><span>{label}</span><code>{present(value)?value:"—"}</code>{!plain&&present(value)&&<CopyBtn value={String(value)} label={label}/>}</div>;
}
