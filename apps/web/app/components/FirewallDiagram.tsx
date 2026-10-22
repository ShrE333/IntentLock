'use client';
import {useEffect,useState} from 'react';
import {DecisionBadge} from './DecisionBadge';

type Decision='ALLOW'|'STEP_UP'|'BLOCK';
const scenarios:{decision:Decision;caption:string;sub:string;amount:string}[]=[
  {decision:'ALLOW',caption:'Inside delegated authority',sub:'Ready for buyer-approved checkout',amount:'USD 49.00'},
  {decision:'STEP_UP',caption:'Human approval required',sub:'Agent cannot extend its own limit',amount:'USD 69.00'},
  {decision:'BLOCK',caption:'Restricted merchant brand',sub:'Execution stops. USD 0 moved.',amount:'USD 35.00'}
];
export function FirewallDiagram(){
  const [index,setIndex]=useState(0);
  useEffect(()=>{
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const timer=window.setInterval(()=>setIndex(x=>(x+1)%scenarios.length),4300);
    return ()=>window.clearInterval(timer);
  },[]);
  const s=scenarios[index];
  return <div className="il-firewall" aria-label="Illustrative authorization firewall, not a live payment" role="group">
    <div className="il-firewall-top"><span className="il-eyebrow">TRANSACTION FIREWALL</span><span className="il-demo-pill">ILLUSTRATIVE CONTROL LOGIC</span></div>
    <div className="il-firewall-flow">
      <div className="il-firewall-node"><span className="il-node-mark">A</span><span className="il-eyebrow">AI AGENT</span><strong>Proposes</strong><small>Search · compare</small></div>
      <div className="il-link-wire"><span/></div>
      <div className="il-firewall-gate"><span className="il-node-mark">I</span><span className="il-eyebrow">INTENTLOCK</span><strong>Authorizes</strong><small>Wallet · payee · quote</small></div>
      <div className={`il-link-wire ${s.decision==='BLOCK'?'il-wire-stop':''}`}><span/></div>
      <div className="il-firewall-node"><span className="il-node-mark">P</span><span className="il-eyebrow">PAYPAL</span><strong>Executes</strong><small>Only after approval</small></div>
    </div>
    <div className="il-firewall-bottom">
      <div><span className="il-eyebrow">CURRENT SCENARIO</span><div className="il-scenario-heading"><strong>{s.amount}</strong><DecisionBadge decision={s.decision}/></div><p>{s.caption}</p><small>{s.sub}</small></div>
      <div className="il-rule-panel"><span className="il-eyebrow">EXAMPLE WALLET RULES</span><div><span>Total authority</span><code>$100</code></div><div><span>Autonomous</span><code>$55</code></div><div><span>Hard ceiling</span><code>$75</code></div><div><span>Brand restriction</span><code>Boat</code></div></div>
    </div>
    <div className="il-firewall-tabs" role="group" aria-label="Firewall scenario">
      {scenarios.map((p,i)=><button key={p.decision} type="button" aria-pressed={i===index} onClick={()=>setIndex(i)} className={i===index?'is-active':''}>{p.decision.replace('_','-')}</button>)}
    </div>
  </div>;
}
