'use client';
import {financialFetch,startNewDemo} from '../demo-access';

import {demoStages,sandboxServicesReady,sandboxWalletAvailable} from '../demo-evidence';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {requireApiUrl} from '../lib';
import {DecisionBadge} from './DecisionBadge';

type Wallet={walletId:string;status:string;currency:string;validUntil:string;totalAuthority:number;spentAmount:number;reservedAmount?:number;autoBuyLimit:number;maxSingleTransaction:number;allowedBrands:string[];blockedBrands:string[]};
type Connector={id:string;enabled:boolean;name:string};
type Session={sessionId:string;status:string;selectedDecision:'ALLOW'|'STEP_UP'|'BLOCK'|null;selectedProduct:{title:string;price:number;currency:string}|null;proofReceiptId?:string|null};
type Run={session:Session;events:{eventType:string}[]};
const products=[
 {name:'Sony WH-CH720N',detail:'Expected to fit a $55 autonomous limit',prompt:'Find Sony WH-CH720N wireless ANC headphones'},
 {name:'Bose QuietComfort',detail:'Evaluate Bose against the selected wallet',prompt:'Find Bose QuietComfort wireless ANC headphones'},
 {name:'Boat Nirvana ANC',detail:'Evaluate Boat against the selected wallet',prompt:'Find Boat Nirvana ANC wireless headphones'},
];
async function api<T>(path:string,init?:RequestInit):Promise<T>{
 const response=await financialFetch(`${requireApiUrl()}${path}`,{cache:'no-store',...init});
 const result=await response.json();
 if(!response.ok)throw new Error(result?.message??result?.error??`Backend returned ${response.status}`);
 return result as T;
}
const body=(data:unknown):RequestInit=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
function ready(w:Wallet){return w.status==='ACTIVE'&&sandboxWalletAvailable(w)>0&&new Date(w.validUntil).getTime()>Date.now()+15*60*1000;}
export function LiveDemoRunner(){
 const [paymentReady,setPaymentReady]=useState(false);
 const [events,setEvents]=useState<{eventType:string}[]>([]);
 const [choice,setChoice]=useState(0);const [wallets,setWallets]=useState<Wallet[]>([]);const [connector,setConnector]=useState<Connector|null>(null);
 const [walletId,setWalletId]=useState('');const [loading,setLoading]=useState(true);const [busy,setBusy]=useState('');const [error,setError]=useState('');const [session,setSession]=useState<Session|null>(null);
 useEffect(()=>{let active=true;(async()=>{try{const [w,c,p]=await Promise.all([api<{wallets:Wallet[]}>('/api/wallets'),api<{connectors:Connector[]}>('/api/commerce/connectors'),api<{paypalConfigured:boolean;paypalEnvironment:string}>('/api/payments/provider')]);if(!active)return;
   const demo=c.connectors.find(x=>x.id==='paypal-demo-marketplace'&&x.enabled)??null;setPaymentReady(sandboxServicesReady(p));
   setConnector(demo);setWallets(w.wallets);setWalletId(w.wallets.find(x=>ready(x)&&x.currency==='USD')?.walletId??'');
  }catch(e){if(active)setError(e instanceof Error?e.message:String(e));}finally{if(active)setLoading(false);}})();return()=>{active=false};},[]);
 const selectedWallet=wallets.find(w=>w.walletId===walletId);
 async function createSandboxWallet(){setBusy('Creating explicit sandbox authority…');setError('');try{
    const validUntil=new Date(Date.now()+24*3600000).toISOString();
    const r=await api<{wallet:Wallet}>('/api/wallets',body({name:'PayPal demo · controlled electronics',countryCode:'US',currency:'USD',totalAuthority:100,autoBuyLimit:55,maxSingleTransaction:75,allowedCategories:['electronics'],allowedBrands:['Sony','Bose'],blockedBrands:['Boat'],requiredFeatures:['wireless','ANC'],validUntil}));
    setWallets(x=>[r.wallet,...x]);setWalletId(r.wallet.walletId);
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy('');}}
 async function run(){if(!connector||!selectedWallet){setError('Create or select an active USD sandbox Intent Wallet first.');return;}
    setBusy('Creating real PurchaseSession…');setError('');setSession(null);setEvents([]);
    try{const created=await api<{session:Session}>('/api/sessions',body({walletId,connectorId:connector.id,prompt:products[choice].prompt,channel:'WEB'}));
      setSession(created.session);setBusy('Searching the sandbox connector and evaluating authority…');
      const result=await api<Run>(`/api/sessions/${encodeURIComponent(created.session.sessionId)}/run`,body({}));setSession(result.session);setEvents(result.events);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy('');}}
 const stages=demoStages(session,events);
 return <div className="il-runner">
  <div className="il-runner-grid"><div className="il-runner-select">
   <div className="il-eyebrow">CHOOSE A SANDBOX SCENARIO</div>
   <div className="il-runner-products">{products.map((p,i)=><button type="button" key={p.name} aria-pressed={choice===i} className={choice===i?'is-active':''} onClick={()=>{setChoice(i);setSession(null);setEvents([]);setError('')}}><span><strong>{p.name}</strong><small>{p.detail}</small></span><small>Backend evaluates</small></button>)}</div>
   {loading?<div className="il-inline-status">Checking the live IntentLock API…</div>:connector?<div className="il-live-dot">Sandbox policy catalog available; payment connectivity is not verified</div>:<div className="il-inline-warning">PayPal sandbox payment services are unavailable or not configured in this deployment.</div>}
   {connector&&!paymentReady&&<div className="il-inline-warning">PayPal sandbox payment services are unavailable or not configured in this deployment.</div>}
   {wallets.some(w=>ready(w)&&w.currency==='USD')&&<label className="il-field">Active USD wallet<select value={walletId} onChange={e=>setWalletId(e.target.value)}><option value="">Choose wallet</option>{wallets.filter(w=>ready(w)&&w.currency==='USD').map(w=><option key={w.walletId} value={w.walletId}>{w.walletId.slice(0,15)}… · ${sandboxWalletAvailable(w).toFixed(2)} remaining</option>)}</select></label>}
   <div className="il-demo-actions">
     {<button type="button" className="il-button il-button--outline" onClick={createSandboxWallet} disabled={!!busy||loading}>Create $100 scenario wallet</button>}
     <button type="button" className="il-button il-button--blue" onClick={run} disabled={!!busy||loading||!connector||!selectedWallet}>{busy||'Run real policy evaluation'}</button>
   </div>
   <p className="il-fine-print">A wallet contains delegated permission, not money. The run uses the real session/commerce/policy APIs. Payment still requires separate PayPal buyer approval; clicking Run never fabricates a capture.</p>
   {error&&<div className="il-form-error" role="alert">{error}<button type="button" onClick={()=>{void startNewDemo();}}>Start a new sandbox session</button></div>}
  </div><div className="il-runner-output">
    <div className="il-between"><span className="il-eyebrow">LIVE CONTROL PATH</span><span className="il-demo-pill">{session?'REAL SESSION':'AWAITING TRANSACTION'}</span></div>
    {['Intent received','Policy decision','Catalog identity · quote bound','PayPal authorize · capture request','Verified webhook · signed proof'].map((s,i)=><div className={`il-runner-stage ${stages[i]?'is-done':''}`} key={s}><span>{String(i+1).padStart(2,'0')}</span><strong>{s}</strong><span>{stages[i]?'✓':'—'}</span></div>)}
    {session?<div className="il-runner-receipt"><span className="il-eyebrow">SESSION STATE</span><div className="il-between"><strong>{session.status.replaceAll('_',' ')}</strong>{session.selectedDecision&&<DecisionBadge decision={session.selectedDecision}/>}</div>{session.selectedProduct&&<p>Selected: {session.selectedProduct.title}</p>}<code title={session.sessionId}>{session.sessionId}</code><div className="il-demo-actions"><Link className="il-button il-button--blue" href={`/new-purchase?sessionId=${encodeURIComponent(session.sessionId)}`}>Continue real transaction</Link><Link className="il-button il-button--outline" href={`/trust-center?sessionId=${encodeURIComponent(session.sessionId)}`}>Inspect evidence</Link></div></div>:<p className="il-output-empty">Select a scenario. IntentLock will create a real session and return an actual policy result—not a scripted success message.</p>}
  </div></div>
 </div>;
}
