'use client';
import Link from 'next/link';
import {startNewDemo} from '../demo-access';
import {usePathname} from 'next/navigation';
import type {ReactNode} from 'react';
import '../intentlock-design.css';

const primary=[
  {href:'/new-purchase',label:'Run purchase',icon:'play'},
  {href:'/wallets',label:'Intent wallets',icon:'wallet'},
  {href:'/commerce',label:'Commerce',icon:'grid'},
  {href:'/trust-center',label:'Transaction control',icon:'activity'},
  {href:'/post-purchase',label:'Post-purchase',icon:'repeat'},
];
const secondary=[
 {href:'/trust',label:'Trust & risk',icon:'shield'},
 {href:'/security-lab',label:'Security lab',icon:'lock'},
 {href:'/evals',label:'Evaluation suite',icon:'check'},
 {href:'/audit',label:'Audit log',icon:'list'},
 {href:'/how-it-works',label:'Architecture',icon:'layers'},
 {href:'/demo',label:'WhatsApp channel',icon:'message'},
];
function Icon({name}:{name:string}){
  const path:Record<string,ReactNode>={
    play:<><path d="m7 4 13 8-13 8V4Z"/></>,
    wallet:<><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M4 6V4a2 2 0 0 1 2-2h13"/><path d="M17 13h4"/></>,
    grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    activity:<><path d="M3 12h4l3-7 4 14 3-7h4"/></>,
    repeat:<><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/></>,
    shield:<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    lock:<><rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    check:<><path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="10"/></>,
    list:<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></>,
    layers:<><path d="m12 2-9 5 9 5 9-5-9-5ZM3 12l9 5 9-5M3 17l9 5 9-5"/></>,
    message:<><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5A8.5 8.5 0 0 1 21 11v.5Z"/></>
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path[name]??path.layers}</svg>;
}
function Brand(){return <Link href="/" className="il-brand"><span className="il-brand-symbol" aria-hidden="true"><span/></span><span>IntentLock</span></Link>}
export function Shell({children}:{children:ReactNode}){
 const pathname=usePathname();
 const current=[...primary,...secondary].find(p=>pathname===p.href||pathname.startsWith(p.href+'/'))?.label??'Control plane';
 return <div className="il-shell"><aside className="il-sidebar"><div className="il-sidebar-brand"><Brand/><span className="il-sidebar-caption">FINANCIAL CONTROL PLANE</span></div>
  <div className="il-sidebar-status"><span className="il-status-dot"/>DEMONSTRATION</div>
  <nav aria-label="Product navigation" className="il-side-links"><span className="il-nav-overline">PRODUCT</span>{primary.map(p=><Link key={p.href} href={p.href} className={`il-side-link ${pathname===p.href||pathname.startsWith(p.href+'/')?'is-active':''}`} aria-current={pathname===p.href?'page':undefined}><Icon name={p.icon}/><span>{p.label}</span></Link>)}<span className="il-nav-overline il-nav-overline--second">EXPLORE</span>{secondary.map(p=><Link key={p.href} href={p.href} className={`il-side-link ${pathname===p.href||pathname.startsWith(p.href+'/')?'is-active':''}`} aria-current={pathname===p.href?'page':undefined}><Icon name={p.icon}/><span>{p.label}</span></Link>)}</nav>
  <div className="il-side-footer"><span>REASONING ≠ AUTHORITY</span><p>Verified payment evidence is the source of settlement truth.</p><a target="_blank" rel="noreferrer" href="https://github.com/ShrE333/IntentLock">GitHub repository ↗</a></div>
 </aside><div className="il-workspace"><header className="il-appbar"><div><span className="il-eyebrow">INTENTLOCK / PRODUCT</span><strong>{current}</strong></div><div className="il-appbar-right"><span className="il-env"><span className="il-status-dot"/> Payment control</span><Link href="/" className="il-appbar-overview">Overview</Link><button type="button" onClick={()=>{void startNewDemo();}}>New sandbox session</button></div></header><main className="il-app-content">{children}</main></div></div>
}
