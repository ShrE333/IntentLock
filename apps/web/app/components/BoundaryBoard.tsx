'use client';

import {useState} from 'react';

type Decision='ALLOW'|'STEP_UP'|'BLOCK';
type Scenario={name:string,merchant:string,price:string,reason:string,decision:Decision,rules:string[],accent:string};
const scenarios:Scenario[]=[
  {name:'Sony WH-CH720N',merchant:'AudioHub Sandbox',price:'$49.00',decision:'ALLOW',accent:'01',reason:'Within the illustrative $55 autonomous threshold and approved-brand rules.',rules:['Brand on allowlist','Price within auto-buy limit','Verified recipient required']},
  {name:'Bose QuietComfort',merchant:'PremiumAudio Sandbox',price:'$69.00',decision:'STEP_UP',accent:'02',reason:'Within the illustrative $75 hard ceiling, but above the $55 auto-buy threshold.',rules:['Brand on allowlist','Exceeds auto-buy limit','Human step-up required']},
  {name:'Boat Nirvana ANC',merchant:'DealDock Sandbox',price:'$35.00',decision:'BLOCK',accent:'03',reason:'Blocked-brand rule takes priority over an attractive price.',rules:['Brand on blocked list','Price does not override rules','No payment permitted']},
];
const outcome:Record<Decision,string>={ALLOW:'Policy permits progression',STEP_UP:'Human approval required',BLOCK:'Execution denied'};
export function BoundaryBoard(){
 const [current,setCurrent]=useState(0);
 const item=scenarios[current];
 return <div className="ix-board" aria-label="Interactive illustrative authorization decisions">
   <div className="ix-board-chrome"><div className="ix-chrome-leds"><i/><i/><i/></div><span>AUTHORITY / INSPECTOR</span><span className="ix-board-version">01—05</span></div>
   <div className="ix-board-body">
     <div className="ix-board-topline"><span className="ix-overline">EXAMPLE POLICY EVALUATION</span><span className="ix-board-demo">ILLUSTRATIVE · NOT A PAYMENT</span></div>
     <div className="ix-board-stats"><div><small>DELEGATED WALLET</small><strong>$100.00 <em>USD</em></strong></div><div><small>AUTO-BUY THRESHOLD</small><strong>$55.00 <em>USD</em></strong></div></div>
     <div className="ix-boundary-ruler"><span>DISCOVERY</span><span>AUTHORITY BOUNDARY</span><span>EXECUTION</span></div>
     <div className="ix-boundary-flow" aria-hidden="true"><div className="ix-flow-agent"><span>01 / PROPOSE</span><div className="ix-agent-orbit">↗</div><strong>AGENT</strong><small>May suggest</small></div><div className="ix-flow-cross"><i/><span>↔</span><i/></div><div className="ix-flow-gate"><div className="ix-gate-core"><span className="ix-gate-shape"/></div><strong>INTENTLOCK</strong><small>Must authorize</small></div><div className="ix-flow-cross"><i/><span>→</span><i/></div><div className="ix-flow-rail"><span>03 / CHECK</span><strong>PAYMENT</strong><small>Provider evidence</small></div></div>
     <div className="ix-board-chooser"><div className="ix-board-chooser-title"><span className="ix-overline">CHANGE THE PROPOSAL</span><span>03 CASES</span></div><div role="group" aria-label="Example product proposals" className="ix-board-tabs">{scenarios.map((s,i)=><button key={s.name} type="button" className={current===i?'selected':''} aria-pressed={current===i} onClick={()=>setCurrent(i)}><span>{s.accent}</span><strong>{s.name.split(' ')[0]}</strong></button>)}</div></div>
     <div className={`ix-board-verdict ix-v-${item.decision.toLowerCase()}`} aria-live="polite"><div className="ix-verdict-heading"><div><span className="ix-overline">CURRENT PROPOSAL / {item.merchant}</span><strong>{item.name}</strong><small>{item.price} · EXAMPLE RULES ONLY</small></div><span className="ix-verdict-chip">{item.decision.replace('_',' ')}</span></div><div className="ix-verdict-divider"/><p>{item.reason}</p><div className="ix-verdict-footer"><span>↳ {outcome[item.decision]}</span><span>POLICY ENGINE / PREVIEW</span></div></div>
   </div>
   <div className="ix-board-bottom"><span><i/> POLICY IS DETERMINISTIC</span><span>NO SIMULATED CAPTURE</span></div>
 </div>;
}
