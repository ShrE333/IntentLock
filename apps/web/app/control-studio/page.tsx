"use client";

import dynamic from 'next/dynamic';
import Link from 'next/link';
import {useCallback,useEffect,useState} from 'react';
import {Shell} from '../components/Shell';
import {getJson} from '../lib';
import {isEmpty,type Dataset,type Win} from './studio-report';

const StudioView=dynamic(()=>import('./StudioView'),{ssr:false,loading:()=><div className="cs-loading" role="status">Loading analytics engine...</div>});
const WINDOWS:Win[]=['24h','7d','30d'];

export default function ControlStudioPage(){
  const [win,setWin]=useState<Win>('7d');
  const [dataset,setDataset]=useState<Dataset|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [editable,setEditable]=useState(false);
  const load=useCallback(async(w:Win)=>{
    setLoading(true);setError('');
    try{setDataset(await getJson<Dataset>(`/api/control-studio/dataset?window=${w}`));}
    catch(e){setDataset(null);setError(e instanceof Error?e.message:'Could not load analytics.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load(win);},[win,load]);
  const scopeLabel=dataset?.scope==='ALL'?'all sandbox data':'your own sandbox data';
  return <Shell><div className="cs-page">
    <header className="cs-head">
      <div>
        <span className="ix-overline">OVERSIGHT / CONTROL STUDIO</span>
        <h1>Control Studio</h1>
        <p className="cs-badge" data-testid="cs-scope">Read-only · redacted · {dataset?scopeLabel:'your own sandbox data'}</p>
      </div>
      <div className="cs-controls">
        <div className="cs-seg" role="group" aria-label="Time window">
          {WINDOWS.map(w=><button key={w} type="button" aria-pressed={w===win} className={w===win?'cs-seg-on':''} onClick={()=>setWin(w)}>{w}</button>)}
        </div>
        <button type="button" className="cs-ghost" aria-pressed={editable} onClick={()=>setEditable(v=>!v)}>{editable?'Lock layout':'Edit layout'}</button>
        <button type="button" className="cs-ghost" onClick={()=>void load(win)} disabled={loading}>Refresh</button>
      </div>
    </header>
    {error&&<div className="cs-state cs-error" role="alert"><strong>Analytics unavailable</strong><p>{error}</p><button type="button" className="cs-ghost" onClick={()=>void load(win)}>Try again</button></div>}
    {!error&&loading&&!dataset&&<div className="cs-loading" role="status">Loading dataset...</div>}
    {dataset&&isEmpty(dataset)&&<div className="cs-state" data-testid="cs-empty"><strong>No activity yet in this sandbox</strong><p>Control Studio only shows real sessions and wallets, and nothing has been recorded for you. Run a purchase to see decisions, agent overrules and wallet exposure appear here.</p><Link href="/new-purchase" className="ix-top-primary">Run a purchase <span>↗</span></Link></div>}
    {dataset&&!isEmpty(dataset)&&<>
      <div className="cs-studio"><StudioView key={`${dataset.window}-${dataset.generatedAt}`} dataset={dataset} editable={editable}/></div>
      <p className="cs-foot">Generated {new Date(dataset.generatedAt).toLocaleString()} · up to {dataset.rowCap} rows per table · identifiers are hashed references, never raw IDs.</p>
    </>}
  </div></Shell>;
}
