"use client";

import {useEffect,useMemo,useState} from "react";
import {Shell} from "../components/Shell";
import {getJson,postJson} from "../lib";

type Wallet={
  walletId:string;name:string;countryCode:string;currency:string;autoBuyLimit:number;maxSingleTransaction:number;
};
type Connector={id:string;name:string;kind:string;enabled:boolean;description:string};
type FxQuote={quoteId:string;fromCurrency:string;toCurrency:string;rate:number;source:string;expiresAt:string;};
type Candidate={
  product:{
    id:string;title:string;brand:string;category:string;merchant:string;merchantCountry?:string;
    price:number;currency:string;features:string[];merchantMessage?:string;
  };
  walletAmount:number|null;walletCurrency:string;fxQuote:FxQuote|null;
  policy:{
    decision:"ALLOW"|"STEP_UP"|"BLOCK";violations:string[];reasons:string[];
    additionalAuthorityRequired:number;canAutoExecute:boolean;requiresHumanApproval:boolean;
  };
  merchantTextTrust:"UNTRUSTED";merchantMessage:string|null;
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

export default function CommercePage(){
  const [wallets,setWallets]=useState<Wallet[]>([]);
  const [connectors,setConnectors]=useState<Connector[]>([]);
  const [walletId,setWalletId]=useState("");
  const [connectorId,setConnectorId]=useState("paypal-demo-marketplace");
  const [query,setQuery]=useState("Sony wireless ANC headphones");
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");

  const wallet=useMemo(()=>wallets.find(w=>w.walletId===walletId)??null,[wallets,walletId]);

  async function load(){
    try{
      const [w,c]=await Promise.all([
        getJson<{wallets:Wallet[]}>("/api/wallets"),
        getJson<{connectors:Connector[]}>("/api/commerce/connectors")
      ]);
      setWallets(w.wallets);setConnectors(c.connectors);
      if(!walletId&&w.wallets[0]) setWalletId(w.wallets[0].walletId);
      const preferred=c.connectors.find(x=>x.enabled&&x.id==="paypal-demo-marketplace")??c.connectors.find(x=>x.enabled);
      if(preferred&&!c.connectors.some(x=>x.id===connectorId&&x.enabled)) setConnectorId(preferred.id);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  }

  useEffect(()=>{load();},[]);

  async function search(){
    if(!walletId){setError("Create/select an Intent Wallet first.");return;}
    setBusy("Searching, binding FX context and evaluating authority…");setError("");setCandidates([]);
    try{
      const r=await postJson<{candidates:Candidate[]}>("/api/commerce/search",{walletId,connectorId,query,limit:10});
      setCandidates(r.candidates);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  return <Shell><div className="page">
    <header className="pageHeader"><div>
      <div className="eyebrow">GLOBAL COMMERCE CONNECTOR LAYER</div>
      <h1>Marketplace Search</h1>
      <p>Products can be quoted in different currencies and countries. IntentLock normalizes each candidate into wallet authority before deciding.</p>
    </div></header>

    <section className="commerceHero"><div>
      <span className="miniLabel">MARKETPLACE + CURRENCY AGNOSTIC</span>
      <h2>The marketplace can change. The payment rail can change. The authorization boundary does not.</h2>
      <p>Merchant prose stays untrusted; structured product facts, country context and bound FX facts enter deterministic policy.</p>
    </div></section>

    <article className="card commerceSearchCard"><div className="commerceSearchGrid">
      <label><span>Intent Wallet</span><select value={walletId} onChange={e=>setWalletId(e.target.value)}>
        <option value="">Select wallet</option>
        {wallets.map(w=><option key={w.walletId} value={w.walletId}>{w.name} · {w.countryCode} · {w.currency} · auto {money(w.autoBuyLimit,w.currency)}</option>)}
      </select></label>
      <label><span>Commerce Connector</span><select value={connectorId} onChange={e=>setConnectorId(e.target.value)}>
        {connectors.map(c=><option key={c.id} value={c.id} disabled={!c.enabled}>{c.name}{c.enabled?"":" — not configured"}</option>)}
      </select></label>
      <label className="commerceQuery"><span>Search</span><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") search();}}/></label>
      <button className="button buttonPrimary" onClick={search} disabled={!!busy}>Search Marketplace</button>
    </div></article>

    <section className="connectorStrip">{connectors.map(c=><div key={c.id} className={c.enabled?"connectorChip active":"connectorChip"}><strong>{c.name}</strong><span>{c.enabled?"CONNECTED":"ADAPTER SLOT"}</span></div>)}</section>

    {busy&&<div className="alert alertInfo">{busy}</div>}
    {error&&<div className="alert alertError">{error}</div>}

    {candidates.length>0&&<section className="commerceResults">
      <div className="resultsHeader"><div><span className="miniLabel">SEARCH RESULTS</span><h2>{candidates.length} candidates evaluated</h2></div>
        <div className="resultCounts"><span>ALLOW {candidates.filter(c=>c.policy.decision==="ALLOW").length}</span><span>STEP_UP {candidates.filter(c=>c.policy.decision==="STEP_UP").length}</span><span>BLOCK {candidates.filter(c=>c.policy.decision==="BLOCK").length}</span></div>
      </div>
      <div className="commerceGrid">{candidates.map(c=><article key={c.product.id} className={`commerceCard ${c.policy.decision.toLowerCase()}`}>
        <div className="commerceCardTop"><div><span className="merchantName">{c.product.merchant} · {c.product.merchantCountry??"--"}</span><h3>{c.product.title}</h3><div className="productMeta">{c.product.brand} · {c.product.category}</div></div><span className={`commerceDecision ${c.policy.decision.toLowerCase()}`}>{c.policy.decision}</span></div>
        <div className="commercePrice">{money(c.product.price,c.product.currency)}</div>
        {c.walletAmount!=null&&<div className="policyBox"><p>Wallet authority cost: <strong>{money(c.walletAmount,c.walletCurrency)}</strong>{c.fxQuote?` · ${c.fxQuote.source}`:" · same currency"}</p></div>}
        {c.fxQuote&&<div className="quoteBinding"><span>FX bound until {new Date(c.fxQuote.expiresAt).toLocaleTimeString()}</span><code>{c.fxQuote.quoteId} · 1 {c.fxQuote.fromCurrency} = {c.fxQuote.rate.toFixed(6)} {c.fxQuote.toCurrency}</code></div>}
        <div className="featureRow">{c.product.features.map(f=><span key={f}>{f}</span>)}</div>
        {c.merchantMessage&&<div className="merchantMessage"><div className="merchantMessageHeader"><span>MERCHANT-SUPPLIED TEXT</span><strong>UNTRUSTED</strong></div><p>{c.merchantMessage}</p></div>}
        <div className="policyBox">
          {c.policy.decision==="ALLOW"&&<p>✓ Fully inside normalized autonomous authority.</p>}
          {c.policy.decision==="STEP_UP"&&<p>⚠ Human step-up required: +{money(c.policy.additionalAuthorityRequired,c.walletCurrency)}</p>}
          {c.policy.decision==="BLOCK"&&<p>✕ {[...c.policy.violations,...c.policy.reasons].join(" · ")}</p>}
        </div>
      </article>)}</div>
    </section>}
  </div></Shell>;
}
