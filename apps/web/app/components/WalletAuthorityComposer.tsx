"use client";
import {useState} from 'react';
import {postJson} from '../lib';
import './wallet-authority.css';
type Policy={name:string;countryCode:string;currency:string;totalAuthority:number;autoBuyLimit:number;maxSingleTransaction:number;allowedCategories:string[];allowedBrands:string[];blockedBrands:string[];requiredFeatures:string[];excludedConditions:string[];validUntil:string};
type Draft={draftId:string;digest:string;expiresAt:string;canonicalPolicy:string;policy:Policy};
type Compile={policy:Partial<Policy>;missing:string[];errors:string[];provenance:Record<string,string>;draft:Draft|null};
const example='Give my shopping agent 100 USD for one day. Allow Sony and Bose electronics. Auto limit 50 USD. Hard ceiling 75 USD. No blocked brands. No required features. New only. Country US.';
const numeric=['totalAuthority','autoBuyLimit','maxSingleTransaction'];
const lists=['allowedCategories','allowedBrands','blockedBrands','requiredFeatures','excludedConditions'];
const fields:Record<keyof Policy,string>={name:'Wallet name',countryCode:'Country (ISO-2; ZZ means unknown)',currency:'Currency (ISO code)',totalAuthority:'Total budget',autoBuyLimit:'Automatic purchase limit',maxSingleTransaction:'Hard transaction ceiling',allowedCategories:'Allowed categories',allowedBrands:'Allowed brands (empty = any)',blockedBrands:'Blocked brands',requiredFeatures:'Required features',excludedConditions:'Excluded conditions: NEW, USED, REFURBISHED',validUntil:'Expiration (UTC ISO timestamp)'};

function requireDraft(value:unknown):Draft{
 const d=value as Draft;
 if(!d||typeof d.draftId!=='string'||!/^wad_[a-f0-9-]{36}$/.test(d.draftId)||typeof d.digest!=='string'||!/^[a-f0-9]{64}$/.test(d.digest)||typeof d.canonicalPolicy!=='string'||!Number.isFinite(Date.parse(d.expiresAt))||!d.policy||
 !Object.keys(fields).every(k=>numeric.includes(k)?typeof d.policy[k as keyof Policy]==='number'&&Number.isFinite(d.policy[k as keyof Policy]):lists.includes(k)?Array.isArray(d.policy[k as keyof Policy])&&(d.policy[k as keyof Policy] as unknown[]).every(v=>typeof v==='string'):typeof d.policy[k as keyof Policy]==='string'))
  throw new Error('The server returned an incomplete policy preview. Please retry; no authority was granted.');
 return d;
}

export function WalletAuthorityComposer({onCreated}:{onCreated:()=>void}){
 const [instruction,setInstruction]=useState('');
 const [form,setForm]=useState<Record<string,string>>({});
 const [origins,setOrigins]=useState<Record<string,string>>({});
 const [draft,setDraft]=useState<Draft|null>(null);
 const [messages,setMessages]=useState<string[]>([]);
 const [busy,setBusy]=useState(false);
 const [accepted,setAccepted]=useState(false);
 const [error,setError]=useState('');
 const [result,setResult]=useState<{decision:string;reasons:string[];violations:string[]}|null>(null);
 const [sample,setSample]=useState({amount:'',brand:'',category:'',features:''});
 const [mode,setMode]=useState('HYPOTHETICAL');
 const invalidate=()=>{setDraft(null);setAccepted(false);setResult(null);};
 async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Request unavailable. Your draft has not been authorized.');}finally{setBusy(false);}}
 async function compile(){invalidate();await run(async()=>{
  const r=await postJson<Compile>('/api/wallet-authority/compile',{instruction});
  if(!r||!r.policy||!Array.isArray(r.missing)||!Array.isArray(r.errors)||!r.provenance)throw new Error('The server returned an incomplete compilation. Please retry; no authority was granted.');
  if(r.draft)requireDraft(r.draft);
  setForm(Object.fromEntries(Object.entries(r.policy).map(([k,v])=>[k,Array.isArray(v)?(v.length?v.join(', '):'none'):String(v)])));
  setOrigins(r.provenance);setMessages([...r.missing.map(k=>'Please specify '+fields[k as keyof Policy]+'.'),...r.errors]);
  setDraft(r.draft);
 });}
 async function preview(){invalidate();await run(async()=>{
  const missing=Object.keys(fields).filter(k=>!form[k]?.trim());
  if(missing.length)throw new Error('Please explicitly specify: '+missing.map(k=>fields[k as keyof Policy]).join(', ')+'. Enter none for an unrestricted list.');
  const policy=Object.fromEntries(Object.keys(fields).map(k=>[k,numeric.includes(k)?(form[k]?.trim()?Number(form[k]):null):lists.includes(k)?form[k]?.trim().toLowerCase()==='none'?[]:(form[k]??'').split(',').map(v=>v.trim()).filter(Boolean):form[k]??'']));
  const r=await postJson<{draft:Draft}>('/api/wallet-authority/preview',{policy});setDraft(requireDraft(r.draft));setMessages([]);
 });}
 async function simulate(){if(!draft)return;await run(async()=>{
  const r=await postJson<{evaluation:typeof result}>('/api/wallet-authority/simulate',{draftId:draft.draftId,digest:draft.digest,mode,
   transaction:{amount:Number(sample.amount),currency:draft.policy.currency,brand:sample.brand,category:sample.category,quantity:1,features:sample.features.split(',').map(s=>s.trim()).filter(Boolean)}});
  if(!r.evaluation||!['ALLOW','STEP_UP','BLOCK'].includes(r.evaluation.decision)||!Array.isArray(r.evaluation.reasons)||!Array.isArray(r.evaluation.violations))throw new Error('The server returned an incomplete simulation. Please retry.');
  setResult(r.evaluation);
 });}
 async function confirm(){if(!draft||!accepted)return;await run(async()=>{
  await postJson('/api/wallet-authority/confirm',{draftId:draft.draftId,digest:draft.digest,humanConfirmed:true});
  invalidate();setMessages(['Wallet confirmed. Its policy history is stored. No payment was initiated.']);onCreated();
 });}
 return <section className="card authorityComposer" aria-labelledby="authority-title">
  <div className="cardHeader"><div><span className="miniLabel">NATURAL-LANGUAGE AUTHORITY COMPILER</span><h2 id="authority-title">Describe your agent’s boundaries</h2><p>Every financial limit needs your instruction. Review the exact rules before authorizing a wallet.</p></div><span className="pill">DRAFT / NOT AUTHORIZED</span></div>
  <label className="walletField"><span>Your instructions</span><textarea disabled={busy} rows={5} maxLength={4000} value={instruction} placeholder={example} onChange={e=>{setInstruction(e.target.value);invalidate();}}/></label>
  <div className="authorityActions"><button disabled={busy} className="button buttonSecondary" onClick={()=>{setInstruction(example);invalidate();}}>Use example</button><button disabled={busy||!instruction.trim()} className="button buttonPrimary" onClick={compile}>Compile draft</button></div>
  <details><summary>Supported instructions and clarification</summary><p>Use separate sentences for budget, automatic limit, hard ceiling, categories, brands, blocked brands, features, condition and expiration. Use exact ISO currencies and UTC dates or a number of days. Unrecognized clauses need clarification. The compiler uses deterministic parsing; it does not let a model grant spending permission.</p><p>“Must ask above 5000” is an approval threshold, so a separate hard ceiling is required. “New only” blocks purchases until condition can be independently verified. Enter “none” explicitly for an unrestricted list.</p></details>
  {!!messages.length&&<div role="status" className="alert alertInfo">{messages.map((m,i)=><p key={i}>{m}</p>)}</div>}
  {Object.keys(form).length>0&&<>
   <h3>Review structured rules</h3><p>EXPLICIT means extracted from a recognized instruction. DISPLAY_DEFAULT and UNKNOWN_COUNTRY grant no additional spending authority. Your edits require a fresh preview.</p>
   <div className="formGrid">{Object.entries(fields).map(([key,label])=><label className="walletField" key={key}><span>{label} <small>{origins[key]??'NEEDS HUMAN INPUT'}</small></span><input disabled={busy} value={form[key]??''} onChange={e=>{setForm({...form,[key]:e.target.value});setOrigins({...origins,[key]:'HUMAN EDIT'});invalidate();}}/></label>)}</div>
   <button disabled={busy} className="button buttonSecondary" onClick={preview}>Validate and preview exact policy</button>
  </>}
  {draft&&<div className="authorityReview">
   <h3>Review before authorization</h3><p>Human approval is required above {draft.policy.currency} {draft.policy.autoBuyLimit}; purchases above {draft.policy.maxSingleTransaction} are blocked. Expires {draft.policy.validUntil}.</p>
   <p>Excluded conditions: {draft.policy.excludedConditions.join(', ')||'none'}. Budget: {draft.policy.currency} {draft.policy.totalAuthority}.</p>
   <details><summary>Exact policy and confirmation digest</summary><pre>{draft.canonicalPolicy}</pre><code>{draft.digest}</code><p>Review expires {draft.expiresAt}. A changed policy requires a new confirmation.</p></details>
   <h3>Test a hypothetical purchase</h3><p>Simulation does not reserve funds, issue STEP-UP grants or clear adaptive risk. Shopify mode discards unverified brand, category and features.</p>
   <div className="formGrid">{Object.entries(sample).map(([key,value])=><label className="walletField" key={key}><span>Sample {key}</span><input disabled={busy} value={value} onChange={e=>{setSample({...sample,[key]:e.target.value});setResult(null);}}/></label>)}
   <label className="walletField"><span>Evidence mode</span><select disabled={busy} value={mode} onChange={e=>{setMode(e.target.value);setResult(null);}}><option value="HYPOTHETICAL">Hypothetical facts</option><option value="SHOPIFY_DISCOVERY">Shopify discovery (unverified attributes)</option></select></label></div>
   <button className="button buttonSecondary" disabled={busy} onClick={simulate}>Simulate policy</button>
   {result&&<div role="status" className="alert alertInfo"><strong>{result.decision.replace('_','-')}</strong>{[...result.violations,...result.reasons].map((v,i)=><p key={i}>{v}</p>)}</div>}
   <label className="authorityConsent"><input type="checkbox" disabled={busy} checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>I reviewed this exact policy and explicitly authorize this wallet’s spending limits and restrictions.</span></label>
   <button className="button buttonPrimary" disabled={busy||!accepted} onClick={confirm}>Confirm and authorize wallet</button>
   <p>Requires an authenticated human session. Machine API credentials cannot confirm. Sandbox sessions retain the USD 100 and one-day limits.</p>
  </div>}
  {busy&&<p role="status">Validating authority…</p>}{error&&<div role="alert" className="alert alertError">{error}</div>}
 </section>;
}
