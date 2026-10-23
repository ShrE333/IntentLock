"use client";

import {useEffect,useMemo,useState} from "react";
import {Shell} from "../components/Shell";
import {getJson,postJson} from "../lib";
import './commerce.css';

type Wallet={
  walletId:string;name:string;countryCode:string;currency:string;totalAuthority:number;spentAmount:number;autoBuyLimit:number;maxSingleTransaction:number;validUntil:string;status:"ACTIVE"|"REVOKED";
};
type Connector={id:string;name:string;kind:string;enabled:boolean;description:string};
type FxQuote={quoteId:string;fromCurrency:string;toCurrency:string;rate:number;source:string;expiresAt:string;};
type Candidate={
  product:{
    id:string;title:string;brand:string;category:string;merchant:string;merchantCountry?:string;
    price:number;currency:string;features:string[];merchantMessage?:string;productUrl?:string;imageUrl?:string;
    source?:{provider:string;marketplaceId?:string;listingId?:string;payeeId?:string;payeeType?:string};
    authorizationContext?:{payeeLock?:{fingerprint:string;trustStatus:string;provider:string;payeeId:string}};
    discovery?:{only:true;productId:string;variantId:string;sellerId:string;sellerDomain:string;sellerUrl:string;minorAmount:number;minorDigits:number;available:boolean;requestedShippingCountry:string;shippingVerified:false;condition:string[];conditionTrust:string;inferredFeatures:string[];inferredAttributes:string[];observedAt:string};
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

const connectorMode=(kind:string)=>["EBAY","SHOPIFY","HTTP_JSON"].includes(kind)?"LIVE":"DEMO";
const walletReady=(w:Wallet)=>w.status==="ACTIVE"&&new Date(w.validUntil).getTime()>Date.now()+15*60*1000&&(w.totalAuthority-w.spentAmount)>0;
const friendly=(code:string)=>({WALLET_EXPIRED:"Wallet expired",WALLET_REVOKED:"Wallet revoked",MAX_SINGLE_TRANSACTION_EXCEEDED:"Above hard ceiling",REMAINING_AUTHORITY_EXCEEDED:"Insufficient remaining authority",CATEGORY_NOT_ALLOWED:"Category not allowed",BRAND_BLOCKED:"Brand blocked",BRAND_NOT_ALLOWED:"Brand not allowed",REQUIRED_FEATURE_MISSING:"Required feature missing"} as Record<string,string>)[code]??code.replaceAll("_"," ");

export default function CommercePage(){
  const [wallets,setWallets]=useState<Wallet[]>([]);
  const [connectors,setConnectors]=useState<Connector[]>([]);
  const [walletId,setWalletId]=useState("");
  const [connectorId,setConnectorId]=useState("");
  const [query,setQuery]=useState("Sony wireless ANC headphones");
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [plannedQuery,setPlannedQuery]=useState("");

  const wallet=useMemo(()=>wallets.find(w=>w.walletId===walletId)??null,[wallets,walletId]);

  async function load(){
    try{
      const [w,c]=await Promise.all([
        getJson<{wallets:Wallet[]}>("/api/wallets"),
        getJson<{connectors:Connector[]}>("/api/commerce/connectors")
      ]);
      setWallets(w.wallets);setConnectors(c.connectors.filter(x=>['paypal-demo-marketplace','shopify-global-catalog'].includes(x.id)));
      if(!walletId){const ready=w.wallets.find(walletReady);if(ready) setWalletId(ready.walletId);}
      const preferred=c.connectors.find(x=>x.enabled&&x.id==="paypal-demo-marketplace")??
        c.connectors.find(x=>x.enabled);
      if(preferred&&!c.connectors.some(x=>x.id===connectorId&&x.enabled)) setConnectorId(preferred.id);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  }

  useEffect(()=>{load();},[]);
  async function recheck(id:string){
    setBusy('Refreshing the exact live variant…');setError('');
    try{const r=await postJson<{candidates:Candidate[]}>('/api/commerce/search',{walletId,connectorId:'shopify-global-catalog',query:'Exact variant refresh',operation:'lookup_catalog',ids:[id],limit:1});
      setCandidates(r.candidates);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy('');}
  }

  async function search(){
    if(!walletId){setError("Create/select an Intent Wallet first.");return;}
    if(wallet&&!walletReady(wallet)){setError("The selected wallet is expired, revoked, empty, or too close to expiry for a safe payment. Select a fresh wallet.");return;}
    setBusy(connectorId==="ebay-browse"?"Searching eBay, refreshing structured listing facts and evaluating authority…":"Searching, binding FX context and evaluating authority…");
    setError("");setCandidates([]);
    try{
      const r=await postJson<{candidates:Candidate[];searchQuery?:string}>("/api/commerce/search",{walletId,connectorId,query,limit:10});
      setCandidates(r.candidates);setPlannedQuery(r.searchQuery??query);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  return <Shell><div className="page commercePage">
    <header className="pageHeader"><div>
      <div className="eyebrow">GLOBAL COMMERCE CONNECTOR LAYER · V11.3</div>
      <h1>Marketplace Search</h1>
      <p>Search first, authorize second. Marketplace discovery uses product intent only; wallet rules are applied independently after results return.</p>
    </div></header>

    <section className="commerceHero"><div>
      <span className="miniLabel">DISCOVERY ONLY · NO MERCHANT CHECKOUT</span>
      <h2>The marketplace can change. The payment rail can change. The authorization boundary does not.</h2>
      <p>Configured catalogs supply structured facts for deterministic policy. Merchant prose stays untrusted; a discovered listing is not a merchant order or verified payment recipient.</p>
    </div></section>

    <article className="card commerceSearchCard"><div className="commerceSearchGrid">
      <label><span>Intent Wallet</span><select value={walletId} disabled={!!busy} onChange={e=>{setWalletId(e.target.value);setCandidates([]);setPlannedQuery('');}}>
        <option value="">Select wallet</option>
        {wallets.map(w=><option key={w.walletId} value={w.walletId} disabled={!walletReady(w)}>{w.name} · {w.countryCode} · {w.currency} · {walletReady(w)?"READY":"UNAVAILABLE"}</option>)}
      </select></label>
      <label><span>Commerce Connector</span><select value={connectorId} disabled={!!busy} onChange={e=>{setConnectorId(e.target.value);setCandidates([]);setPlannedQuery('');}}>
        {connectors.map(c=><option key={c.id} value={c.id} disabled={!c.enabled}>{c.name} · {connectorMode(c.kind)}{c.enabled?"":" — not configured"}</option>)}
      </select></label>
      <label className="commerceQuery"><span>Search</span><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") search();}}/></label>
      <button className="button buttonPrimary" onClick={search} disabled={!!busy}>Search Marketplace</button>
    </div></article>

    <section className="connectorStrip">{connectors.map(c=><div key={c.id} className={c.enabled?"connectorChip active":"connectorChip"}><strong>{c.name}</strong><span>{c.enabled?`${connectorMode(c.kind)} · CONFIGURED`:"ADAPTER SLOT"}</span></div>)}</section>
    {connectorId==='shopify-global-catalog'&&<div className="alert alertInfo">Live Shopify catalog discovery only. ALLOW is a policy evaluation, not payment permission. No cart, checkout or merchant fulfillment is created. Inferred attributes cannot satisfy hard wallet restrictions.</div>}

    {busy&&<div className="alert alertInfo">{busy}</div>}
    {error&&<div className="alert alertError">{error}</div>}

    {plannedQuery&&<div className="alert alertInfo"><strong>Discovery query:</strong> {plannedQuery} · Wallet policy was not used as a hidden marketplace filter.</div>}
    {plannedQuery&&!busy&&!error&&candidates.length===0&&<div className="alert alertInfo">No exact variants were returned. No policy approval or checkout was created.</div>}

    {candidates.length>0&&<section className="commerceResults">
      <div className="resultsHeader"><div><span className="miniLabel">SEARCH RESULTS</span><h2>{candidates.length} candidates evaluated</h2></div>
        <div className="resultCounts"><span>ALLOW {candidates.filter(c=>c.policy.decision==="ALLOW").length}</span><span>STEP_UP {candidates.filter(c=>c.policy.decision==="STEP_UP").length}</span><span>BLOCK {candidates.filter(c=>c.policy.decision==="BLOCK").length}</span></div>
      </div>
      <div className="commerceGrid">{candidates.map(c=><article key={c.product.id} className={`commerceCard ${c.policy.decision.toLowerCase()}`}>
        {c.product.imageUrl&&<img src={c.product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" style={{width:"100%",height:180,objectFit:"contain",borderRadius:12,background:"#fff",marginBottom:14}}/>}
        <div className="commerceCardTop"><div><span className="merchantName">{c.product.merchant} · {c.product.merchantCountry??"--"}</span><h3>{c.product.title}</h3><div className="productMeta">{c.product.brand} · {c.product.category}{c.product.source?.marketplaceId?` · ${c.product.source.marketplaceId}`:""}</div></div><span className={`commerceDecision ${c.policy.decision.toLowerCase()}`}>{c.policy.decision}</span></div>
        <div className="commercePrice">{c.product.discovery?new Intl.NumberFormat('en-US',{style:'currency',currency:c.product.currency,minimumFractionDigits:c.product.discovery.minorDigits,maximumFractionDigits:c.product.discovery.minorDigits}).format(c.product.price):money(c.product.price,c.product.currency)}</div>
        {c.product.discovery&&<div className="quoteBinding">
          <strong>Shopify live catalog · {c.product.discovery.available?'Available':'Unavailable'} · discovery only</strong>
          <code>Product: {c.product.discovery.productId}</code><code>Exact variant: {c.product.discovery.variantId}</code>
          <code>Seller: {c.product.discovery.sellerId} · {c.product.discovery.sellerDomain}</code>
          <span>Merchant storefront: {c.product.discovery.sellerUrl}</span>
          <span>Exact price: {c.product.discovery.minorAmount} {c.product.currency} minor units</span>
          <span>Requested shipping destination: {c.product.discovery.requestedShippingCountry} · not checkout-verified</span>
          <span>Condition (inferred): {c.product.discovery.condition.join(', ')||'Not supplied'}</span>
          <span>Observed: {new Date(c.product.discovery.observedAt).toLocaleString()} · not checkout-verified</span>
          <span>Inferred features (not policy evidence): {c.product.discovery.inferredFeatures.join(', ')||'Not supplied'}</span>
          <span>Inferred options/attributes (not policy evidence): {c.product.discovery.inferredAttributes.join(', ')||'Not supplied'}</span>
          <button type="button" className="button buttonSecondary" onClick={()=>recheck(c.product.id)} disabled={!!busy}>Refresh exact variant</button>
        </div>}
        {c.product.authorizationContext?.payeeLock&&<div className="quoteBinding"><span>PayeeLock · {c.product.authorizationContext.payeeLock.trustStatus}</span><code>{c.product.authorizationContext.payeeLock.provider} · {c.product.authorizationContext.payeeLock.payeeId} · {c.product.authorizationContext.payeeLock.fingerprint.slice(0,24)}…</code></div>}
        {c.walletAmount!=null&&<div className="policyBox"><p>Wallet authority cost: <strong>{money(c.walletAmount,c.walletCurrency)}</strong>{c.fxQuote?` · ${c.fxQuote.source}`:" · same currency"}</p></div>}
        {c.fxQuote&&<div className="quoteBinding"><span>FX bound until {new Date(c.fxQuote.expiresAt).toLocaleTimeString()}</span><code>{c.fxQuote.quoteId} · 1 {c.fxQuote.fromCurrency} = {c.fxQuote.rate.toFixed(6)} {c.fxQuote.toCurrency}</code></div>}
        <div className="featureRow">{c.product.features.map(f=><span key={f}>{f}</span>)}</div>
        {c.merchantMessage&&<div className="merchantMessage"><div className="merchantMessageHeader"><span>{c.product.discovery?'CATALOG TEXT · MAY BE INFERRED':'MERCHANT-SUPPLIED TEXT'}</span><strong>UNTRUSTED</strong></div><p>{c.merchantMessage}</p></div>}
        <div className="policyBox">
          {c.policy.decision==="ALLOW"&&<p>{c.product.discovery?'Policy evaluation passed; financial execution remains disabled.':'✓ Fully inside normalized autonomous authority.'}</p>}
          {c.policy.decision==="STEP_UP"&&<p>⚠ Human step-up required: +{money(c.policy.additionalAuthorityRequired,c.walletCurrency)}</p>}
          {c.policy.decision==="BLOCK"&&<p>✕ {[...c.policy.violations.map(friendly),...c.policy.reasons].join(" · ")}</p>}
        </div>
        {c.product.productUrl&&<a className="button buttonSecondary" href={c.product.productUrl} target="_blank" rel="noreferrer">Open marketplace listing</a>}
      </article>)}</div>
    </section>}
  </div></Shell>;
}
