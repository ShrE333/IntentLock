'use client';
import {useState} from 'react';
import {DecisionBadge} from './DecisionBadge';
const products=[
  {id:'sony1',brand:'Sony',title:'WH-CH720N · wireless ANC',price:49},
  {id:'bose',brand:'Bose',title:'QuietComfort · wireless ANC',price:69},
  {id:'sony2',brand:'Sony',title:'Wireless flagship · hard ceiling',price:89},
  {id:'boat',brand:'Boat',title:'Nirvana ANC · blocked brand',price:35},
];
export function WalletLab(){
  const [limit,setLimit]=useState(55);
  return <div className="il-wallet-lab">
    <div className="il-wallet-card"><div className="il-between"><span className="il-eyebrow">ILLUSTRATIVE INTENT WALLET</span><span className="il-demo-pill">HOLDS NO MONEY</span></div>
      <div className="il-wallet-amount">$100<span>.00</span></div><span className="il-wallet-label">Total delegated authority</span>
      <div className="il-wallet-slider-heading"><strong>Autonomous limit</strong><code>${limit}.00</code></div>
      <input type="range" min="10" max="75" step="1" value={limit} onChange={e=>setLimit(Number(e.target.value))} aria-label="Example autonomous spending limit"/>
      <div className="il-slider-markers"><span>$10</span><span>$75</span></div>
      <div className="il-wallet-rules"><div><span>Hard transaction ceiling</span><code>$75</code></div><div><span>Allowed</span><code>Sony, Bose</code></div><div><span>Blocked</span><code>Boat</code></div><div><span>Required</span><code>Wireless · ANC</code></div></div>
    </div>
    <div className="il-wallet-results"><div className="il-between"><strong>Four proposals, one policy</strong><span className="il-eyebrow">INSTANT LOCAL PREVIEW</span></div>
      {products.map(p=>{const decision=p.brand==='Boat'||p.price>75?'BLOCK':p.price>limit?'STEP_UP':'ALLOW';return <div className="il-product-row" key={p.id}><div><strong>{p.brand}</strong><small>{p.title}</small></div><code>${p.price}.00</code><DecisionBadge decision={decision}/></div>})}
      <p className="il-fine-print">This interactive explanation runs locally. Real purchases are evaluated again by the backend against a stored wallet and current provider facts.</p>
    </div>
  </div>;
}
