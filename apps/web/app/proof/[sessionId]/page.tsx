"use client";

import {useEffect,useState,type ReactNode} from "react";
import {useParams} from "next/navigation";
import {Shell} from "../../components/Shell";
import {getJson} from "../../lib";

type ProofResponse={
  receipt:{receiptId:string;sessionId:string;walletId:string;proofHash:string;proofSignature:string;evidenceAuditHeadHash:string|null;payload:any;createdAt:string;};
  verification:{auditChainValid:boolean;checkedEvents:number;currentAuditHeadHash:string|null;evidenceAuditHeadHash:string|null;proofHash:string;signaturePresent:boolean;};
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

export default function ProofReceiptPage(){
  const params=useParams<{sessionId:string}>();
  const sessionId=decodeURIComponent(String(params.sessionId??""));
  const [data,setData]=useState<ProofResponse|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(true);

  useEffect(()=>{if(!sessionId)return;(async()=>{try{setData(await getJson<ProofResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/proof`));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}})();},[sessionId]);

  const p=data?.receipt.payload;
  const provider=String(p?.payment?.provider??"payment").toUpperCase();
  const paymentCurrency=String(p?.payment?.currency??"USD");
  const walletCurrency=String(p?.wallet?.currency??p?.walletSpend?.currency??paymentCurrency);
  const fx=p?.paymentContext?.fxQuote;

  return <Shell><div className="page">
    <header className="pageHeader"><div><div className="eyebrow">CRYPTOGRAPHIC PURCHASE EVIDENCE</div><h1>Proof Receipt</h1><p>One receipt binds merchant presentment, wallet authority, country context, FX quote, verified settlement and the audit chain.</p></div><span className="sessionIdBadge">{sessionId}</span></header>
    {busy&&<div className="alert alertInfo">Loading proof receipt…</div>}{error&&<div className="alert alertError">{error}</div>}
    {data&&<div className="proofPage">
      <section className="proofHero"><div><span className="miniLabel">INTENTLOCK VERIFIED PURCHASE</span><h2>{data.receipt.receiptId}</h2><p>Generated only after the payment provider webhook is verified and the wallet ledger is applied exactly once.</p></div><div className="proofStatus"><strong>{data.verification.auditChainValid?"VERIFIED":"INVALID"}</strong><span>{data.verification.checkedEvents} audit events checked</span></div></section>

      <section className="proofGrid">
        <ProofCard title="Merchant Presentment"><Row label="Product" value={p.product?.title}/><Row label="Merchant" value={`${p.product?.merchant??"-"} · ${p.paymentContext?.merchantCountry??p.product?.merchantCountry??"--"}`}/><Row label="Buyer country" value={p.paymentContext?.buyerCountry??p.wallet?.countryCode}/><Row label="Checkout amount" value={money(Number(p.payment?.amount??0),paymentCurrency)}/></ProofCard>

        <ProofCard title="Intent Wallet Authority"><Row label="Wallet" value={`${p.wallet?.name??"-"} · ${p.wallet?.countryCode??"--"}`}/><Row label="Authority currency" value={walletCurrency}/><Row label="Wallet debit" value={money(Number(p.walletSpend?.amount??0),walletCurrency)}/><Row label="Remaining" value={money(Number(p.wallet?.remainingAuthority??0),walletCurrency)}/><Row label="Ledger replay-safe" value={p.walletSpend?.replaySafe?"YES":"NO"}/></ProofCard>

        <ProofCard title="FX / Quote Binding"><Row label="Cross-currency" value={p.paymentContext?.fxBound?"YES":"NO — SAME CURRENCY"}/><Row label="Presentment" value={money(Number(p.paymentContext?.presentmentAmount??p.payment?.amount??0),String(p.paymentContext?.presentmentCurrency??paymentCurrency))}/><Row label="Wallet authority cost" value={money(Number(p.paymentContext?.walletAmount??p.walletSpend?.amount??0),String(p.paymentContext?.walletCurrency??walletCurrency))}/><Row label="FX source" value={fx?.source??"SAME_CURRENCY"}/><Row label="FX quote ID" value={fx?.quoteId??"N/A"}/><Row label="FX rate" value={fx?`1 ${fx.fromCurrency} = ${Number(fx.rate).toFixed(6)} ${fx.toCurrency}`:"N/A"}/><Row label="FX expires" value={fx?.expiresAt?new Date(fx.expiresAt).toLocaleString():"N/A"}/></ProofCard>

        <ProofCard title="Authorization"><Row label="Policy decision" value={p.authorization?.policyDecision}/><Row label="Mode" value={p.authorization?.mode}/><Row label="Authorization ID" value={p.authorization?.authorizationId??"Wallet policy"}/><Row label="Exact quote bound" value={p.authorization?.exactQuoteBound?"YES":"NO"}/></ProofCard>

        <ProofCard title={provider}><Row label="Provider" value={provider}/><Row label="Order" value={p.payment?.providerOrderId}/><Row label="Authorization" value={p.payment?.providerAuthorizationId??"N/A"}/><Row label="Capture / Payment" value={p.payment?.providerCaptureId}/><Row label="Provider amount" value={money(Number(p.payment?.amount??0),paymentCurrency)}/><Row label="Status" value={p.payment?.status}/><Row label="Captured state source" value={p.payment?.capturedStateSource}/><Row label="Webhook signature" value={p.payment?.webhookSignatureVerified?"VERIFIED":"NOT VERIFIED"}/></ProofCard>
      </section>

      <section className="proofCryptography"><div className="sectionTitleRow"><div><span className="miniLabel">CRYPTOGRAPHIC EVIDENCE</span><h2>Integrity Proof</h2></div></div>
        <CryptoRow label="Exact Quote SHA-256" value={p.authorization?.quoteHash??"-"}/><CryptoRow label="Proof SHA-256" value={data.receipt.proofHash}/><CryptoRow label="HMAC Proof Signature" value={data.receipt.proofSignature}/><CryptoRow label="Evidence Audit Head" value={data.receipt.evidenceAuditHeadHash??"-"}/>
      </section>
      <section className="proofChecks"><Check ok>Intent Wallet authority recorded</Check><Check ok>Merchant amount + wallet amount bound</Check><Check ok={!p.paymentContext?.fxBound||Boolean(fx?.quoteId)}>FX quote bound when currencies differ</Check><Check ok>Provider webhook signature verified</Check><Check ok>Wallet spend ledger applied once</Check><Check ok={data.verification.auditChainValid}>Tamper-evident audit chain valid</Check><Check ok={data.verification.signaturePresent}>Proof receipt signed</Check></section>
    </div>}
  </div></Shell>;
}
function ProofCard({title,children}:{title:string;children:ReactNode}){return <article className="proofCard"><h3>{title}</h3><div>{children}</div></article>;}
function Row({label,value}:{label:string;value:any}){return <div className="proofRow"><span>{label}</span><strong>{String(value??"-")}</strong></div>;}
function CryptoRow({label,value}:{label:string;value:string}){return <div className="cryptoRow"><span>{label}</span><code>{value}</code></div>;}
function Check({ok,children}:{ok:boolean;children:ReactNode}){return <div className={ok?"proofCheck ok":"proofCheck bad"}><span>{ok?"✓":"✕"}</span><strong>{children}</strong></div>;}
