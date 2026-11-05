'use client';

import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {useEffect,useMemo,useState} from 'react';
import type {ReactNode} from 'react';
import {startNewDemo} from '../demo-access';

type NavItem={href:string,label:string,icon:string,subtitle:string};
const groups:{label:string,items:NavItem[]}[]=[
 {label:'WORKSPACE',items:[
  {href:'/new-purchase',label:'Run a purchase',icon:'arrow',subtitle:'Create and execute an intent'},
  {href:'/wallets',label:'Intent wallets',icon:'wallet',subtitle:'Set spending authority'},
  {href:'/commerce',label:'Marketplace',icon:'grid',subtitle:'Discover and evaluate listings'},
 ]},
 {label:'OVERSIGHT',items:[
  {href:'/trust-center',label:'Transaction control',icon:'pulse',subtitle:'Follow settlement and evidence'},
  {href:'/post-purchase',label:'Post-purchase',icon:'repeat',subtitle:'Refunds and disputes'},
  {href:'/audit',label:'Audit trail',icon:'list',subtitle:'Event history'},
 ]},
 {label:'UNDER THE HOOD',items:[
  {href:'/trust',label:'Trust & risk',icon:'shield',subtitle:'Financial safeguards'},
  {href:'/security-lab',label:'Security lab',icon:'lock',subtitle:'Adversarial controls'},
  {href:'/evals',label:'Evaluation suite',icon:'check',subtitle:'Automated policy tests'},
  {href:'/how-it-works',label:'Architecture',icon:'layers',subtitle:'How the system is wired'},
  {href:'/demo',label:'WhatsApp channel',icon:'message',subtitle:'Another way to issue intents'},
 ]}
];
const flat=groups.flatMap(g=>g.items);
function Icon({name,size=19}:{name:string,size?:number}){
 const paths:Record<string,ReactNode>={
  arrow:<><path d="M5 12h14m-6-6 6 6-6 6"/></>,
  wallet:<><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M4 6V4a2 2 0 0 1 2-2h13M16 14h5"/></>,
  grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  pulse:<><path d="M3 12h4l3-7 4 14 3-7h4"/></>,
  repeat:<><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/></>,
  list:<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></>,
  shield:<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
  lock:<><rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  check:<><path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="10"/></>,
  layers:<><path d="m12 2-9 5 9 5 9-5-9-5ZM3 12l9 5 9-5M3 17l9 5 9-5"/></>,
  message:<><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5A8.5 8.5 0 0 1 21 11v.5Z"/></>,
  search:<><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
  close:<><path d="M5 5l14 14M19 5 5 19"/></>,
  menu:<><path d="M4 7h16M4 12h16M4 17h16"/></>,
  external:<><path d="M13 5h6v6M19 5l-9 9"/><path d="M19 13v6H5V5h6"/></>
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.layers}</svg>;
}
export function Identity({inverse=false}:{inverse?:boolean}){return <Link href="/" className={`ix-identity ${inverse?'ix-identity-light':''}`} aria-label="IntentLock home"><span className="ix-lockmark" aria-hidden="true"><span/><i/></span><span className="ix-logotype">intentlock<span className="ix-logotype-dot">.</span></span></Link>}
export function Shell({children}:{children:ReactNode}){
 const pathname=usePathname();
 const router=useRouter();
 const [drawer,setDrawer]=useState(false);
 const [palette,setPalette]=useState(false);
 const [search,setSearch]=useState('');
 const [selectedResult,setSelectedResult]=useState(0);
 const current=flat.find(x=>pathname===x.href||pathname.startsWith(x.href+'/'));
 const results=useMemo(()=>flat.filter(x=>(x.label+' '+x.subtitle).toLowerCase().includes(search.trim().toLowerCase())),[search]);
 useEffect(()=>{setDrawer(false);setPalette(false);setSearch('');setSelectedResult(0)},[pathname]);
 useEffect(()=>{setSelectedResult(0)},[search]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPalette(x=>!x)}if(e.key==='Escape'){setPalette(false);setDrawer(false)}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[]);
 return <div className="ix-app il-shell">
  {drawer&&<button aria-label="Close navigation" type="button" className="ix-drawer-scrim" onClick={()=>setDrawer(false)}/>}
  <aside className={`ix-sidebar ${drawer?'ix-sidebar-open':''}`}>
   <div className="ix-side-header"><Identity inverse/><button className="ix-close-mobile" aria-label="Close menu" type="button" onClick={()=>setDrawer(false)}><Icon name="close"/></button><div className="ix-side-edition">THE AUTHORIZATION LAYER <span> / 2026</span></div></div>
   <div className="ix-side-session"><span className="ix-signal-dot"/><div><strong>SANDBOX WORKSPACE</strong><small>Controlled test environment</small></div><span className="ix-session-orbit">↗</span></div>
   <nav className="ix-side-nav" aria-label="Application navigation">{groups.map((group,i)=><div className="ix-side-group" key={group.label}><div className="ix-side-group-title"><span>{group.label}</span><span>0{i+1}</span></div>{group.items.map(item=>{const active=pathname===item.href||pathname.startsWith(item.href+'/');return <Link key={item.href} href={item.href} aria-current={active?'page':undefined} className={`ix-nav-item ${active?'ix-nav-item-active':''}`}><Icon name={item.icon} size={17}/><span>{item.label}</span>{active&&<span className="ix-active-needle"/>}</Link>})}</div>)}</nav>
   <div className="ix-side-bottom"><div className="ix-boundary-brand"><span className="ix-overline">THE NON-NEGOTIABLE</span><p>Reasoning is not <em>authority.</em></p><div className="ix-mini-spectrum"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div><div className="ix-side-legal"><span>PAYPAL SANDBOX · NON-LIVE</span><a href="https://github.com/ShrE333/IntentLock" target="_blank" rel="noreferrer" aria-label="Open IntentLock on GitHub"><Icon name="external" size={15}/></a></div></div>
  </aside>
  <div className="ix-workspace"><header className="ix-topbar"><div className="ix-topbar-left"><button type="button" className="ix-mobile-menu" aria-label="Open navigation" onClick={()=>setDrawer(true)}><Icon name="menu"/></button><span className="ix-breadcrumb-overline">WORKSPACE / <span>{current?'PRODUCT':'OVERVIEW'}</span></span><strong>{current?.label??'Control plane'}</strong></div><div className="ix-topbar-right"><span className="ix-top-status"><span className="ix-signal-dot"/> SANDBOX</span><button type="button" className="ix-quick-search" onClick={()=>setPalette(true)} aria-label="Search pages"><Icon name="search" size={17}/><span>Jump to...</span><kbd>⌘ K</kbd></button><Link href="/new-purchase" className="ix-top-primary">New purchase <span>↗</span></Link></div></header>
    <div className="ix-route-ribbon"><div><span>01</span> INTENT</div><i/><div><span>02</span> POLICY</div><i/><div><span>03</span> PERMISSION</div><i/><div><span>04</span> EVIDENCE</div><div className="ix-ribbon-note">NO UNSIGNED SETTLEMENT</div></div>
    <main className="ix-workspace-main il-app-content">{children}</main>
    <footer className="ix-workspace-footer"><span>INTENTLOCK / SANDBOX</span><span>Delegate authority. Never delegate accountability.</span><Link href="/how-it-works">Explore architecture ↗</Link></footer>
  </div>
  {palette&&<div className="ix-command-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setPalette(false)}}><section role="dialog" aria-modal="true" aria-label="Jump to a page" className="ix-command-dialog"><div className="ix-command-search"><Icon name="search"/><input autoFocus aria-label="Search IntentLock pages" placeholder="Where would you like to go?" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setSelectedResult(x=>Math.min(x+1,results.length-1))}else if(e.key==='ArrowUp'){e.preventDefault();setSelectedResult(x=>Math.max(0,x-1))}else if(e.key==='Enter'&&results[selectedResult]){e.preventDefault();router.push(results[selectedResult].href);setPalette(false)}}}/><button aria-label="Close search" onClick={()=>setPalette(false)} type="button"><kbd>ESC</kbd></button></div><div className="ix-command-items"><span className="ix-overline">{results.length} DESTINATIONS</span>{results.map((item,i)=><Link href={item.href} key={item.href} className={`ix-command-item ${i===selectedResult?'ix-command-item-highlighted':''}`} onMouseEnter={()=>setSelectedResult(i)} onClick={()=>setPalette(false)}><span className="ix-command-icon"><Icon name={item.icon}/></span><span><strong>{item.label}</strong><small>{item.subtitle}</small></span><span className="ix-command-arrow">↗</span></Link>)}{results.length===0&&<p className="ix-command-empty">No matching pages. Try “wallet” or “proof”.</p>}</div><div className="ix-command-footer"><span>↑ ↓ NAVIGATE</span><span>ESC CLOSE</span><button type="button" onClick={()=>{setPalette(false);void startNewDemo()}}>Reset sandbox session ↗</button></div></section></div>}
 </div>;
}
