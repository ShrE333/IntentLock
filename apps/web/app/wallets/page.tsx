"use client";

import {useEffect,useMemo,useState} from "react";
import {Shell} from "../components/Shell";
import {getJson,postJson} from "../lib";

type Wallet={
  walletId:string;name:string;currency:string;
  totalAuthority:number;spentAmount:number;
  autoBuyLimit:number;maxSingleTransaction:number;
  allowedCategories:string[];allowedBrands:string[];
  blockedBrands:string[];requiredFeatures:string[];
  validUntil:string;status:"ACTIVE"|"REVOKED";
};

type Evaluation={
  decision:"ALLOW"|"STEP_UP"|"BLOCK";
  violations:string[];reasons:string[];
  remainingAuthority:number;requestedAmount:number;
  additionalAuthorityRequired:number;
  canAutoExecute:boolean;requiresHumanApproval:boolean;
};

type StepUpRequest={
  requestId:string;
  status:string;
  quoteHash:string;
  requestedAmount:number;
  currentAutoBuyLimit:number;
  additionalAuthorityRequired:number;
  expiresAt:string;
};

type Resolution={
  decision:"APPROVED_ONCE"|"LIMIT_RAISED"|"REJECTED";
  paymentAllowed:boolean;
  authorizationId?:string;
  token?:string;
  quoteHash?:string;
  amount?:number;
  expiresAt?:string;
  newAutoBuyLimit?:number;
};

const csv=(s:string)=>s.split(",").map(x=>x.trim()).filter(Boolean);

export default function WalletsPage(){
  const [wallets,setWallets]=useState<Wallet[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [evaluation,setEvaluation]=useState<Evaluation|null>(null);
  const [stepUp,setStepUp]=useState<StepUpRequest|null>(null);
  const [resolution,setResolution]=useState<Resolution|null>(null);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");

  const [form,setForm]=useState({
    name:"Personal Electronics",totalAuthority:"10000",
    autoBuyLimit:"6000",maxSingleTransaction:"7000",
    allowedCategories:"electronics",allowedBrands:"Sony, Bose",
    blockedBrands:"Boat",requiredFeatures:"wireless, ANC",validityHours:"24"
  });

  const [tx,setTx]=useState({
    productName:"Sony Wireless ANC Headphones",
    category:"electronics",brand:"Sony",amount:"5899",
    quantity:"1",features:"wireless, ANC"
  });

  const selected=useMemo(
    ()=>wallets.find(w=>w.walletId===selectedId)??null,
    [wallets,selectedId]
  );

  async function load(){
    setError("");
    try{
      const r=await getJson<{wallets:Wallet[]}>("/api/wallets");
      setWallets(r.wallets);
      if(!selectedId && r.wallets[0]) setSelectedId(r.wallets[0].walletId);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  }

  useEffect(()=>{load();},[]);

  async function create(){
    setBusy("Creating autonomy mandate…");setError("");setEvaluation(null);setStepUp(null);setResolution(null);
    try{
      const validUntil=new Date(Date.now()+Number(form.validityHours)*3600000).toISOString();
      const r=await postJson<{wallet:Wallet}>("/api/wallets",{
        name:form.name,currency:"INR",
        totalAuthority:Number(form.totalAuthority),
        autoBuyLimit:Number(form.autoBuyLimit),
        maxSingleTransaction:Number(form.maxSingleTransaction),
        allowedCategories:csv(form.allowedCategories),
        allowedBrands:csv(form.allowedBrands),
        blockedBrands:csv(form.blockedBrands),
        requiredFeatures:csv(form.requiredFeatures),
        validUntil
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
        `/api/wallets/${encodeURIComponent(selected.walletId)}/evaluate`,
        {
          productName:tx.productName,category:tx.category,brand:tx.brand,
          amount:Number(tx.amount),currency:"INR",quantity:Number(tx.quantity),
          features:csv(tx.features)
        }
      );
      setEvaluation(r.evaluation);
      setStepUp(r.stepUp);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  async function resolve(action:"ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT"){
    if(!selected || !stepUp) return;
    setBusy(action==="ALLOW_ONCE"?"Signing one-time authority…":
            action==="RAISE_LIMIT"?"Updating autonomous limit…":"Rejecting request…");
    setError("");
    try{
      const r=await postJson<{result:Resolution}>(
        `/api/wallets/${encodeURIComponent(selected.walletId)}/step-up/${encodeURIComponent(stepUp.requestId)}/resolve`,
        {action}
      );
      setResolution(r.result);
      if(action==="RAISE_LIMIT") await load();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }

  return <Shell><div className="page">
    <header className="pageHeader">
      <div>
        <div className="eyebrow">DELEGATED SPENDING AUTHORITY</div>
        <h1>Intent Wallets</h1>
        <p>Bound AI autonomy with deterministic limits and cryptographic step-up consent.</p>
      </div>
    </header>

    <section className="walletHero">
      <div>
        <span className="miniLabel">CORE IDEA</span>
        <h2>Don't give an AI your wallet. Give it an Intent Wallet.</h2>
        <p>IntentLock stores authority — not money. Razorpay remains the payment rail.</p>
      </div>
      <div className="decisionLegend">
        <span className="decisionMini allow">ALLOW</span><span>/</span>
        <span className="decisionMini step">STEP_UP</span><span>/</span>
        <span className="decisionMini block">BLOCK</span>
      </div>
    </section>

    <div className="walletTopGrid">
      <article className="card">
        <div className="cardHeader"><div>
          <h2>Create Autonomy Mandate</h2>
          <p>Define exactly what an agent can do without human intervention.</p>
        </div></div>

        <div className="formGrid">
          <Field label="Wallet name" value={form.name} onChange={v=>setForm({...form,name:v})}/>
          <Field label="Total authority (₹)" type="number" value={form.totalAuthority} onChange={v=>setForm({...form,totalAuthority:v})}/>
          <Field label="Auto-buy limit (₹)" type="number" value={form.autoBuyLimit} onChange={v=>setForm({...form,autoBuyLimit:v})}/>
          <Field label="Max single transaction (₹)" type="number" value={form.maxSingleTransaction} onChange={v=>setForm({...form,maxSingleTransaction:v})}/>
          <Field label="Allowed categories" value={form.allowedCategories} onChange={v=>setForm({...form,allowedCategories:v})}/>
          <Field label="Allowed brands" value={form.allowedBrands} onChange={v=>setForm({...form,allowedBrands:v})}/>
          <Field label="Blocked brands" value={form.blockedBrands} onChange={v=>setForm({...form,blockedBrands:v})}/>
          <Field label="Required features" value={form.requiredFeatures} onChange={v=>setForm({...form,requiredFeatures:v})}/>
          <Field label="Valid for (hours)" type="number" value={form.validityHours} onChange={v=>setForm({...form,validityHours:v})}/>
        </div>
        <div className="actionRow">
          <button className="button buttonPrimary" onClick={create} disabled={!!busy}>Create Intent Wallet</button>
        </div>
      </article>

      <article className="card">
        <div className="cardHeader"><div>
          <h2>Active Wallets</h2><p>Delegated authority currently stored in Neon.</p>
        </div><span className="pill">{wallets.length} TOTAL</span></div>

        <div className="walletList">
          {!wallets.length && <div className="walletEmpty">No Intent Wallet yet.</div>}
          {wallets.map(w=><button key={w.walletId}
            className={w.walletId===selectedId?"walletListItem active":"walletListItem"}
            onClick={()=>{setSelectedId(w.walletId);setEvaluation(null);setStepUp(null);setResolution(null);}}>
            <div><strong>{w.name}</strong><span>₹{(w.totalAuthority-w.spentAmount).toLocaleString("en-IN")} remaining</span></div>
            <span className="walletStatus">{w.status}</span>
          </button>)}
        </div>
      </article>
    </div>

    {selected && <section className="walletDecisionGrid">
      <article className="card">
        <div className="cardHeader"><div>
          <span className="miniLabel">SELECTED WALLET</span><h2>{selected.name}</h2>
        </div><span className="pill pillSuccess">{selected.status}</span></div>

        <div className="walletMetrics">
          <Metric label="Total Authority" value={`₹${selected.totalAuthority.toLocaleString("en-IN")}`}/>
          <Metric label="Auto-Buy" value={`≤ ₹${selected.autoBuyLimit.toLocaleString("en-IN")}`} success/>
          <Metric label="Step-Up Zone" value={`₹${selected.autoBuyLimit.toLocaleString("en-IN")}–₹${selected.maxSingleTransaction.toLocaleString("en-IN")}`}/>
          <Metric label="Hard Ceiling" value={`₹${selected.maxSingleTransaction.toLocaleString("en-IN")}`}/>
        </div>

        <div className="walletRules">
          <Rule label="Allowed Brands" value={selected.allowedBrands.join(", ")||"Any"}/>
          <Rule label="Blocked Brands" value={selected.blockedBrands.join(", ")||"None"}/>
          <Rule label="Required" value={selected.requiredFeatures.join(", ")||"None"}/>
          <Rule label="Expires" value={new Date(selected.validUntil).toLocaleString()}/>
        </div>
      </article>

      <article className="card">
        <div className="cardHeader"><div>
          <h2>Authority Simulator</h2><p>Try a compliant, step-up, or blocked transaction.</p>
        </div></div>

        <div className="formGrid compact">
          <Field label="Product" value={tx.productName} onChange={v=>setTx({...tx,productName:v})}/>
          <Field label="Brand" value={tx.brand} onChange={v=>setTx({...tx,brand:v})}/>
          <Field label="Category" value={tx.category} onChange={v=>setTx({...tx,category:v})}/>
          <Field label="Amount (₹)" type="number" value={tx.amount} onChange={v=>setTx({...tx,amount:v})}/>
          <Field label="Quantity" type="number" value={tx.quantity} onChange={v=>setTx({...tx,quantity:v})}/>
          <Field label="Features" value={tx.features} onChange={v=>setTx({...tx,features:v})}/>
        </div>

        <div className="simulatorPresets">
          <button onClick={()=>setTx({...tx,brand:"Sony",amount:"5899"})}>ALLOW ₹5,899</button>
          <button onClick={()=>setTx({...tx,brand:"Sony",amount:"6499"})}>STEP_UP ₹6,499</button>
          <button onClick={()=>setTx({...tx,brand:"Boat",amount:"3999"})}>BLOCK Boat</button>
        </div>

        <button className="button buttonPrimary buttonWide" onClick={evaluate} disabled={!!busy}>Evaluate Transaction</button>
      </article>
    </section>}

    {evaluation && <article className={`decisionCard ${evaluation.decision.toLowerCase()}`}>
      <div className="decisionTop">
        <div><span className="miniLabel">INTENTLOCK DECISION</span><h2>{evaluation.decision}</h2></div>
        <div className="decisionAmount">₹{evaluation.requestedAmount.toLocaleString("en-IN")}</div>
      </div>

      <p>{evaluation.decision==="ALLOW"?"The agent may execute this purchase autonomously.":
        evaluation.decision==="STEP_UP"?`The proposal is valid, but requires ₹${evaluation.additionalAuthorityRequired.toLocaleString("en-IN")} of additional human authority.`:
        "The proposal violates the mandate. Money movement must not occur."}</p>

      <div className="decisionReasons">
        {[...evaluation.violations,...evaluation.reasons].map(r=><span key={r}>
          {evaluation.decision==="ALLOW"?"✓":evaluation.decision==="STEP_UP"?"⚠":"✕"} {r}
        </span>)}
      </div>

      {evaluation.decision==="STEP_UP" && stepUp && !resolution && <div className="stepUpPanel">
        <div className="stepUpHeader">
          <div>
            <span className="miniLabel">HUMAN CONSENT REQUIRED</span>
            <h3>Agent needs +₹{stepUp.additionalAuthorityRequired.toLocaleString("en-IN")}</h3>
          </div>
          <span className="stepUpExpiry">expires {new Date(stepUp.expiresAt).toLocaleTimeString()}</span>
        </div>

        <div className="stepUpCompare">
          <div><span>Autonomous authority</span><strong>₹{stepUp.currentAutoBuyLimit.toLocaleString("en-IN")}</strong></div>
          <div><span>Requested checkout</span><strong>₹{stepUp.requestedAmount.toLocaleString("en-IN")}</strong></div>
          <div><span>Extra authority</span><strong>+₹{stepUp.additionalAuthorityRequired.toLocaleString("en-IN")}</strong></div>
        </div>

        <div className="quoteBinding">
          <span>Exact quote binding</span>
          <code>{stepUp.quoteHash}</code>
        </div>

        <div className="stepUpActions">
          <button className="button buttonSecondary" onClick={()=>resolve("REJECT")} disabled={!!busy}>Reject</button>
          <button className="button buttonSecondary" onClick={()=>resolve("RAISE_LIMIT")} disabled={!!busy}>Raise Auto Limit</button>
          <button className="button buttonPrimary" onClick={()=>resolve("ALLOW_ONCE")} disabled={!!busy}>Allow Once ₹{stepUp.requestedAmount.toLocaleString("en-IN")}</button>
        </div>
      </div>}

      {resolution && <div className={`resolutionPanel ${resolution.decision.toLowerCase()}`}>
        <span className="miniLabel">STEP-UP RESOLUTION</span>
        <h3>{resolution.decision.replaceAll("_"," ")}</h3>

        {resolution.decision==="APPROVED_ONCE" && <>
          <p>A cryptographically signed, exact-quote, one-time authorization has been issued.</p>
          <div className="resolutionGrid">
            <div><span>Authorization</span><strong>{resolution.authorizationId}</strong></div>
            <div><span>Amount</span><strong>₹{resolution.amount?.toLocaleString("en-IN")}</strong></div>
            <div><span>Payment allowed</span><strong>YES — ONCE</strong></div>
            <div><span>Expires</span><strong>{resolution.expiresAt?new Date(resolution.expiresAt).toLocaleTimeString():"-"}</strong></div>
          </div>
          <div className="tokenPreview"><span>Signed token</span><code>{resolution.token?.slice(0,72)}…</code></div>
        </>}

        {resolution.decision==="LIMIT_RAISED" && <p>
          The wallet's persistent autonomous ceiling is now ₹{resolution.newAutoBuyLimit?.toLocaleString("en-IN")}.
        </p>}

        {resolution.decision==="REJECTED" && <p>
          Human authorization was denied. Payment is not allowed.
        </p>}
      </div>}
    </article>}

    {busy && <div className="alert alertInfo">{busy}</div>}
    {error && <div className="alert alertError">{error}</div>}
  </div></Shell>;
}

function Field({label,value,onChange,type="text"}:{label:string;value:string;onChange:(v:string)=>void;type?:string}){
  return <label className="walletField"><span>{label}</span><input type={type} value={value} onChange={e=>onChange(e.target.value)}/></label>;
}
function Metric({label,value,success}:{label:string;value:string;success?:boolean}){
  return <div className="walletMetric"><span>{label}</span><strong className={success?"textSuccess":""}>{value}</strong></div>;
}
function Rule({label,value}:{label:string;value:string}){
  return <div className="walletRule"><span>{label}</span><strong>{value}</strong></div>;
}
