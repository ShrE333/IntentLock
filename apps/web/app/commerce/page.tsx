"use client";

import {useEffect,useState} from "react";
import {Shell} from "../components/Shell";
import {getJson,postJson} from "../lib";

type Wallet={
  walletId:string;
  name:string;
  autoBuyLimit:number;
  maxSingleTransaction:number;
};

type Connector={
  id:string;
  name:string;
  kind:string;
  enabled:boolean;
  description:string;
};

type Candidate={
  product:{
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
  policy:{
    decision:"ALLOW"|"STEP_UP"|"BLOCK";
    violations:string[];
    reasons:string[];
    additionalAuthorityRequired:number;
    canAutoExecute:boolean;
    requiresHumanApproval:boolean;
  };
  merchantTextTrust:"UNTRUSTED";
  merchantMessage:string|null;
};

export default function CommercePage(){
  const [wallets,setWallets]=useState<Wallet[]>([]);
  const [connectors,setConnectors]=useState<Connector[]>([]);
  const [walletId,setWalletId]=useState("");
  const [connectorId,setConnectorId]=useState("demo-marketplace");
  const [query,setQuery]=useState("wireless ANC headphones");
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");

  async function load(){
    try{
      const [w,c]=await Promise.all([
        getJson<{wallets:Wallet[]}>("/api/wallets"),
        getJson<{connectors:Connector[]}>("/api/commerce/connectors")
      ]);
      setWallets(w.wallets);
      setConnectors(c.connectors);
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

  async function search(){
    if(!walletId){setError("Create/select an Intent Wallet first.");return;}
    setBusy("Searching commerce connectors…");
    setError("");
    setCandidates([]);
    try{
      const r=await postJson<{candidates:Candidate[]}>("/api/commerce/search",{
        walletId,connectorId,query,limit:10
      });
      setCandidates(r.candidates);
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }finally{
      setBusy("");
    }
  }

  return <Shell><div className="page">
    <header className="pageHeader">
      <div>
        <div className="eyebrow">COMMERCE CONNECTOR LAYER</div>
        <h1>Marketplace Search</h1>
        <p>Search through pluggable commerce providers, then classify every product through the selected Intent Wallet.</p>
      </div>
    </header>

    <section className="commerceHero">
      <div>
        <span className="miniLabel">MARKETPLACE-AGNOSTIC</span>
        <h2>The marketplace can change. The authorization boundary does not.</h2>
        <p>Merchant text is treated as untrusted input; only structured facts reach the deterministic wallet policy.</p>
      </div>
    </section>

    <article className="card commerceSearchCard">
      <div className="commerceSearchGrid">
        <label>
          <span>Intent Wallet</span>
          <select value={walletId} onChange={e=>setWalletId(e.target.value)}>
            <option value="">Select wallet</option>
            {wallets.map(w=><option key={w.walletId} value={w.walletId}>
              {w.name} · auto ₹{w.autoBuyLimit} · hard ₹{w.maxSingleTransaction}
            </option>)}
          </select>
        </label>

        <label>
          <span>Commerce Connector</span>
          <select value={connectorId} onChange={e=>setConnectorId(e.target.value)}>
            {connectors.map(c=><option key={c.id} value={c.id} disabled={!c.enabled}>
              {c.name}{c.enabled?"":" — not configured"}
            </option>)}
          </select>
        </label>

        <label className="commerceQuery">
          <span>Search</span>
          <input value={query} onChange={e=>setQuery(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter") search();}}/>
        </label>

        <button className="button buttonPrimary" onClick={search} disabled={!!busy}>
          Search Marketplace
        </button>
      </div>
    </article>

    <section className="connectorStrip">
      {connectors.map(c=><div key={c.id} className={c.enabled?"connectorChip active":"connectorChip"}>
        <strong>{c.name}</strong>
        <span>{c.enabled?"CONNECTED":"ADAPTER SLOT"}</span>
      </div>)}
    </section>

    {busy && <div className="alert alertInfo">{busy}</div>}
    {error && <div className="alert alertError">{error}</div>}

    {candidates.length>0 && <section className="commerceResults">
      <div className="resultsHeader">
        <div>
          <span className="miniLabel">SEARCH RESULTS</span>
          <h2>{candidates.length} candidates evaluated</h2>
        </div>
        <div className="resultCounts">
          <span>ALLOW {candidates.filter(c=>c.policy.decision==="ALLOW").length}</span>
          <span>STEP_UP {candidates.filter(c=>c.policy.decision==="STEP_UP").length}</span>
          <span>BLOCK {candidates.filter(c=>c.policy.decision==="BLOCK").length}</span>
        </div>
      </div>

      <div className="commerceGrid">
        {candidates.map(c=><article key={c.product.id} className={`commerceCard ${c.policy.decision.toLowerCase()}`}>
          <div className="commerceCardTop">
            <div>
              <span className="merchantName">{c.product.merchant}</span>
              <h3>{c.product.title}</h3>
              <div className="productMeta">{c.product.brand} · {c.product.category}</div>
            </div>
            <span className={`commerceDecision ${c.policy.decision.toLowerCase()}`}>{c.policy.decision}</span>
          </div>

          <div className="commercePrice">₹{c.product.price.toLocaleString("en-IN")}</div>

          <div className="featureRow">
            {c.product.features.map(f=><span key={f}>{f}</span>)}
          </div>

          {c.merchantMessage && <div className="merchantMessage">
            <div className="merchantMessageHeader">
              <span>MERCHANT-SUPPLIED TEXT</span>
              <strong>UNTRUSTED</strong>
            </div>
            <p>{c.merchantMessage}</p>
          </div>}

          <div className="policyBox">
            {c.policy.decision==="ALLOW" && <p>✓ Fully inside autonomous authority.</p>}
            {c.policy.decision==="STEP_UP" && <p>⚠ Human step-up required: +₹{c.policy.additionalAuthorityRequired.toLocaleString("en-IN")}</p>}
            {c.policy.decision==="BLOCK" && <p>✕ {c.policy.violations.join(" · ")}</p>}
          </div>
        </article>)}
      </div>
    </section>}
  </div></Shell>;
}
