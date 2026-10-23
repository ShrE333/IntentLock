"use client";

import {useEffect,useMemo,useState} from "react";
import {WalletAuthorityComposer} from '../components/WalletAuthorityComposer';
import {Shell} from "../components/Shell";
import {getJson,postJson} from "../lib";

type Wallet={
  walletId:string;name:string;countryCode:string;currency:string;totalAuthority:number;spentAmount:number;reservedAmount?:number;
  autoBuyLimit:number;maxSingleTransaction:number;allowedCategories:string[];
  allowedBrands:string[];blockedBrands:string[];requiredFeatures:string[];
  excludedConditions?:string[];validUntil:string;status:"ACTIVE"|"REVOKED";
};

type Evaluation={
  decision:"ALLOW"|"STEP_UP"|"BLOCK";violations:string[];reasons:string[];
  remainingAuthority:number;requestedAmount:number;additionalAuthorityRequired:number;
  canAutoExecute:boolean;requiresHumanApproval:boolean;
};

type StepUpRequest={
  requestId:string;status:string;quoteHash:string;requestedAmount:number;
  currentAutoBuyLimit:number;additionalAuthorityRequired:number;expiresAt:string;
};

type Resolution={
  decision:"APPROVED_ONCE"|"LIMIT_RAISED"|"REJECTED";paymentAllowed:boolean;
  authorizationId?:string;token?:string;quoteHash?:string;amount?:number;
  expiresAt?:string;newAutoBuyLimit?:number;
};

const csv=(s:string)=>s.split(",").map(x=>x.trim()).filter(Boolean);
const CURRENCIES=["INR","USD","EUR","GBP","SGD","AUD","CAD","JPY","CHF","HKD","NZD","SEK","NOK","DKK","PLN","CZK","MXN","BRL","ILS","HUF","MYR","TWD","THB","PHP","CNY"];
const money=(n:number,currency:string)=>new Intl.NumberFormat("en-US",{
  style:"currency",currency,maximumFractionDigits:["JPY","HUF","TWD"].includes(currency)?0:2
}).format(n);

export default function WalletsPage(){
  const [loading,setLoading]=useState(true);
  const [wallets,setWallets]=useState<Wallet[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [evaluation,setEvaluation]=useState<Evaluation|null>(null);
  const [stepUp,setStepUp]=useState<StepUpRequest|null>(null);
  const [resolution,setResolution]=useState<Resolution|null>(null);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");

  const [form,setForm]=useState({
    name:"Sandbox Electronics",countryCode:"US",currency:"USD",totalAuthority:"100",
    autoBuyLimit:"55",maxSingleTransaction:"75",allowedCategories:"electronics",
    allowedBrands:"Sony, Bose",blockedBrands:"Boat",requiredFeatures:"wireless, ANC",
    validityHours:"24"
  });

  const [tx,setTx]=useState({
    productName:"Sony Wireless ANC Headphones",category:"electronics",brand:"Sony",
    amount:"49",quantity:"1",features:"wireless, ANC"
  });

  const selected=useMemo(()=>wallets.find(w=>w.walletId===selectedId)??null,[wallets,selectedId]);

  async function load(){
    try{
      const r=await getJson<{wallets:Wallet[]}>("/api/wallets");
      setWallets(r.wallets);
      if(!selectedId&&r.wallets[0]) setSelectedId(r.wallets[0].walletId);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);}
  }
  useEffect(()=>{load();},[]);

  async function create(){
    setBusy("Creating global autonomy mandate…");setError("");setEvaluation(null);setStepUp(null);setResolution(null);
    try{
      const validUntil=new Date(Date.now()+Number(form.validityHours)*3600000).toISOString();
      const r=await postJson<{wallet:Wallet}>("/api/wallets",{
        name:form.name,countryCode:form.countryCode.toUpperCase(),currency:form.currency,
        totalAuthority:Number(form.totalAuthority),autoBuyLimit:Number(form.autoBuyLimit),
        maxSingleTransaction:Number(form.maxSingleTransaction),
        allowedCategories:csv(form.allowedCategories),allowedBrands:csv(form.allowedBrands),
        blockedBrands:csv(form.blockedBrands),requiredFeatures:csv(form.requiredFeatures),validUntil
      });
      await load();setSelectedId(r.wallet.walletId);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  async function evaluate(){
    if(!selected){setError("Create or select an Intent Wallet first.");return;}
    setBusy("Evaluating delegated authority…");setError("");setEvaluation(null);setStepUp(null);setResolution(null);
    try{
      const r=await postJson<{evaluation:Evaluation;stepUp:StepUpRequest|null}>(
        `/api/wallets/${encodeURIComponent(selected.walletId)}/evaluate`,{
          productName:tx.productName,category:tx.category,brand:tx.brand,
          amount:Number(tx.amount),currency:selected.currency,quantity:Number(tx.quantity),
          features:csv(tx.features)
        }
      );
      setEvaluation(r.evaluation);setStepUp(r.stepUp);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  async function resolve(action:"ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT"){
    if(!selected||!stepUp) return;
    setBusy("Resolving step-up authority…");setError("");
    try{
      const r=await postJson<{result:Resolution}>(
        `/api/wallets/${encodeURIComponent(selected.walletId)}/step-up/${encodeURIComponent(stepUp.requestId)}/resolve`,
        {action}
      );
      setResolution(r.result);if(action==="RAISE_LIMIT") await load();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  return <Shell><div className="page">
    <header className="pageHeader"><div>
      <div className="eyebrow">DELEGATED SPENDING AUTHORITY</div>
      <h1>Intent Wallets</h1>
      <p>Wallet rules are live policy, not demo outcomes. Expiry, remaining authority, brand/category restrictions and limits are evaluated from the selected wallet on every transaction.</p>
    </div></header>

    <section className="walletHero"><div>
      <span className="miniLabel">CROSS-CURRENCY AUTHORITY</span>
      <h2>An INR wallet can authorize a USD, EUR, GBP or SGD checkout without silently changing its budget.</h2>
      <p>IntentLock converts the merchant quote into wallet authority, hashes the FX facts into the authorization, then selects a payment rail by capability.</p>
    </div></section>

    <WalletAuthorityComposer onCreated={()=>{void load();}}/>

    <div className="walletTopGrid">
      <article className="card">
        <div className="cardHeader"><div><h2>Create Autonomy Mandate</h2><p>Define the owner context and exact spending authority.</p></div></div>
        <div className="formGrid">
          <Field label="Wallet name" value={form.name} onChange={v=>setForm({...form,name:v})}/>
          <Field label="Buyer country (ISO-2)" value={form.countryCode} onChange={v=>setForm({...form,countryCode:v.toUpperCase().slice(0,2)})}/>
          <label className="walletField"><span>Authority currency</span><select value={form.currency} onChange={e=>setForm({...form,currency:e.target.value})}>{CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
          <Field label={`Total authority (${form.currency})`} type="number" value={form.totalAuthority} onChange={v=>setForm({...form,totalAuthority:v})}/>
          <Field label={`Auto-buy limit (${form.currency})`} type="number" value={form.autoBuyLimit} onChange={v=>setForm({...form,autoBuyLimit:v})}/>
          <Field label={`Max single transaction (${form.currency})`} type="number" value={form.maxSingleTransaction} onChange={v=>setForm({...form,maxSingleTransaction:v})}/>
          <Field label="Allowed categories" value={form.allowedCategories} onChange={v=>setForm({...form,allowedCategories:v})}/>
          <Field label="Allowed brands" value={form.allowedBrands} onChange={v=>setForm({...form,allowedBrands:v})}/>
          <Field label="Blocked brands" value={form.blockedBrands} onChange={v=>setForm({...form,blockedBrands:v})}/>
          <Field label="Required features" value={form.requiredFeatures} onChange={v=>setForm({...form,requiredFeatures:v})}/>
          <Field label="Valid for (hours)" type="number" value={form.validityHours} onChange={v=>setForm({...form,validityHours:v})}/>
        </div>
        <button className="button buttonPrimary" onClick={create} disabled={!!busy}>Create Intent Wallet</button>
      </article>

      <article className="card">
        <div className="cardHeader"><div><h2>Active Wallets</h2><p>Delegated authority currently stored in Neon.</p></div><span className="pill">{wallets.length} TOTAL</span></div>
        <div className="walletList">
          {loading?<div className="walletEmpty" role="status">Loading Intent Wallets...</div>:!wallets.length&&<div className="walletEmpty">No Intent Wallet yet.</div>}
          {wallets.map(w=>{const expired=new Date(w.validUntil).getTime()<=Date.now();return <button key={w.walletId} className={w.walletId===selectedId?"walletListItem active":"walletListItem"} onClick={()=>{setSelectedId(w.walletId);setEvaluation(null);setStepUp(null);setResolution(null);}}>
            <div><strong>{w.name}</strong><span>{money(w.totalAuthority-w.spentAmount-(w.reservedAmount??0),w.currency)} available · {money(w.reservedAmount??0,w.currency)} reserved · expires {new Date(w.validUntil).toLocaleString()}</span></div><span className="walletStatus">{w.countryCode} · {w.currency} · {w.status!=="ACTIVE"?"REVOKED":expired?"EXPIRED":"READY"}</span>
          </button>;})}
        </div>
      </article>
    </div>

    {!!selected?.excludedConditions?.length&&<div className="alert alertInfo">This wallet requires independently verified product condition. Current catalog adapters cannot establish that evidence, so purchases remain blocked.</div>}

    {selected&&<section className="walletDecisionGrid">
      <article className="card"><div className="cardHeader"><div><span className="miniLabel">SELECTED WALLET</span><h2>{selected.name}</h2></div><span className="pill pillSuccess">{selected.countryCode} · {selected.status}</span></div>
        <div className="walletMetrics">
          <Metric label="Total Authority" value={money(selected.totalAuthority,selected.currency)}/>
          <Metric label="Auto-Buy" value={`≤ ${money(selected.autoBuyLimit,selected.currency)}`} success/>
          <Metric label="Step-Up Zone" value={`${money(selected.autoBuyLimit,selected.currency)}–${money(selected.maxSingleTransaction,selected.currency)}`}/>
          <Metric label="Hard Ceiling" value={money(selected.maxSingleTransaction,selected.currency)}/>
          <Metric label="Excluded Conditions" value={selected.excludedConditions?.join(", ")||"None"}/>
          <Metric label="Valid Until" value={new Date(selected.validUntil).toLocaleString()}/>
        </div>
      </article>

      {(selected.status!=="ACTIVE"||new Date(selected.validUntil).getTime()<=Date.now())&&<div className="alert alertError" style={{gridColumn:"1 / -1"}}>This wallet cannot start a new purchase because it is {selected.status!=="ACTIVE"?"revoked":"expired"}. Create a fresh wallet instead of testing against stale authority.</div>}

      <article className="card"><div className="cardHeader"><div><h2>Authority Simulator</h2><p>This simulator uses the wallet currency. Cross-currency normalization happens in Marketplace / Autonomous Purchase.</p></div></div>
        <div className="formGrid compact">
          <Field label="Product" value={tx.productName} onChange={v=>setTx({...tx,productName:v})}/>
          <Field label="Brand" value={tx.brand} onChange={v=>setTx({...tx,brand:v})}/>
          <Field label="Category" value={tx.category} onChange={v=>setTx({...tx,category:v})}/>
          <Field label={`Amount (${selected.currency})`} type="number" value={tx.amount} onChange={v=>setTx({...tx,amount:v})}/>
          <Field label="Quantity" type="number" value={tx.quantity} onChange={v=>setTx({...tx,quantity:v})}/>
          <Field label="Features" value={tx.features} onChange={v=>setTx({...tx,features:v})}/>
        </div>
        <button className="button buttonPrimary buttonWide" onClick={evaluate} disabled={!!busy}>Evaluate Transaction</button>
      </article>
    </section>}

    {evaluation&&selected&&<article className={`decisionCard ${evaluation.decision.toLowerCase()}`}>
      <div className="decisionTop"><div><span className="miniLabel">INTENTLOCK DECISION</span><h2>{evaluation.decision}</h2></div><div className="decisionAmount">{money(evaluation.requestedAmount,selected.currency)}</div></div>
      <div className="decisionReasons">{[...evaluation.violations,...evaluation.reasons].map(r=><span key={r}>{r}</span>)}</div>
      {evaluation.decision==="STEP_UP"&&stepUp&&!resolution&&<div className="stepUpPanel">
        <h3>Human authority required: +{money(stepUp.additionalAuthorityRequired,selected.currency)}</h3>
        <div className="quoteBinding"><span>Exact quote binding</span><code>{stepUp.quoteHash}</code></div>
        <div className="stepUpActions">
          <button className="button buttonSecondary" onClick={()=>resolve("REJECT")}>Reject</button>
          <button className="button buttonSecondary" onClick={()=>resolve("RAISE_LIMIT")}>Raise Auto Limit</button>
          <button className="button buttonPrimary" onClick={()=>resolve("ALLOW_ONCE")}>Allow Once</button>
        </div>
      </div>}
      {resolution&&<div className={`resolutionPanel ${resolution.decision.toLowerCase()}`}><h3>{resolution.decision.replaceAll("_"," ")}</h3><p>{resolution.decision==="APPROVED_ONCE"?"Exact-quote one-time authority issued.":resolution.decision==="LIMIT_RAISED"?"Wallet autonomous limit updated.":"Human authorization denied."}</p></div>}
    </article>}

    {busy&&<div className="alert alertInfo">{busy}</div>}
    {error&&<div className="alert alertError">{error}</div>}
  </div></Shell>;
}

function Field({label,value,onChange,type="text"}:{label:string;value:string;onChange:(v:string)=>void;type?:string}){
  return <label className="walletField"><span>{label}</span><input type={type} value={value} onChange={e=>onChange(e.target.value)}/></label>;
}
function Metric({label,value,success}:{label:string;value:string;success?:boolean}){
  return <div className="walletMetric"><span>{label}</span><strong className={success?"textSuccess":""}>{value}</strong></div>;
}
