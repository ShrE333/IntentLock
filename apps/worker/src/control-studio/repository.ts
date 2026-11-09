import {neon} from '@neondatabase/serverless';
import {sha256} from '../access/identity';
import {ROW_CAP,WINDOWS,type StudioDataset,type StudioScope,type StudioWindow,type SessionRow,type DecisionRow,type AgentRow,type WalletRow,type RefundRow} from './types';

// Same read-access predicate as LIST_WALLETS_SQL (GET /api/wallets): $1 NULL = ops (all rows).
// Everything below is a SELECT. This module never writes.
const WALLET_READ=`($1::text IS NULL OR
 EXISTS(SELECT 1 FROM financial_resource_owners o WHERE o.resource_type='wallet' AND o.resource_id=w.wallet_id AND o.principal_id=$1)
 OR EXISTS(SELECT 1 FROM financial_wallet_grants g WHERE g.wallet_id=w.wallet_id AND g.principal_id=$1 AND 'read'=ANY(g.permissions) AND g.revoked_at IS NULL AND g.expires_at>NOW()))`;

export const SESSIONS_SQL=`SELECT s.session_id,s.created_at,s.status,s.selected_decision,s.connector_id,
 s.selected_product->>'currency' AS product_currency,s.selected_product->>'price' AS product_price,
 w.currency AS wallet_currency,
 (SELECT e.payload->>'walletAmount' FROM purchase_session_events e WHERE e.session_id=s.session_id AND e.event_type='CANDIDATE_SELECTED' ORDER BY e.event_seq DESC LIMIT 1) AS wallet_amount,
 (SELECT e.payload->>'mode' FROM purchase_session_events e WHERE e.session_id=s.session_id AND e.event_type='AGENT_RECOMMENDATION' ORDER BY e.event_seq DESC LIMIT 1) AS agent_mode,
 (SELECT e.payload->'overruleReasons' FROM purchase_session_events e WHERE e.session_id=s.session_id AND e.event_type='AGENT_RECOMMENDATION_OVERRULED' ORDER BY e.event_seq DESC LIMIT 1) AS overrule_reasons,
 EXISTS(SELECT 1 FROM purchase_session_events e WHERE e.session_id=s.session_id AND e.event_type='AGENT_RECOMMENDATION_OVERRULED') AS overruled,
 (s.proof_receipt_id IS NOT NULL OR EXISTS(SELECT 1 FROM proof_receipts p WHERE p.session_id=s.session_id)) AS proof_present
 FROM purchase_sessions s JOIN intent_wallets w ON w.wallet_id=s.wallet_id
 WHERE ${WALLET_READ} AND s.created_at>=$2::timestamptz ORDER BY s.created_at DESC LIMIT ${ROW_CAP}`;

export const EVENTS_SQL=`SELECT e.session_id,e.event_type,e.payload FROM purchase_session_events e
 JOIN purchase_sessions s ON s.session_id=e.session_id JOIN intent_wallets w ON w.wallet_id=s.wallet_id
 WHERE ${WALLET_READ} AND s.created_at>=$2::timestamptz AND e.event_type=$3
 ORDER BY e.event_seq DESC LIMIT ${ROW_CAP}`;

export const WALLETS_SQL=`SELECT w.wallet_id,w.currency,w.total_authority,w.spent_amount,w.reserved_amount,w.status,w.valid_until
 FROM intent_wallets w WHERE ${WALLET_READ} ORDER BY w.created_at DESC LIMIT ${ROW_CAP}`;

export const REFUNDS_SQL=`SELECT r.refund_id,r.status,r.amount,r.currency,r.created_at
 FROM session_refunds r JOIN intent_wallets w ON w.wallet_id=r.wallet_id
 WHERE ${WALLET_READ} AND r.created_at>=$2::timestamptz ORDER BY r.created_at DESC LIMIT ${ROW_CAP}`;

const ref=async(id:unknown)=>(await sha256(String(id))).slice(0,8);
const num=(v:unknown)=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
const iso=(v:unknown)=>new Date(v as string).toISOString();
const parse=(v:unknown):unknown=>{if(typeof v!=='string')return v;try{return JSON.parse(v);}catch{return null;}};
// Reason codes are enum-like identifiers; keep only that shape so free text can never leak.
const codes=(v:unknown):string=>{const a=parse(v);return (Array.isArray(a)?a:[]).map(String).filter(c=>/^[A-Z0-9_]{1,64}$/.test(c)).join(',');};
const payloadOf=(v:unknown):Record<string,unknown>=>{const p=parse(v);return p&&typeof p==='object'?p as Record<string,unknown>:{};};

export async function buildDataset(db:string,principalId:string|undefined,window:StudioWindow,now=new Date()):Promise<StudioDataset>{
  const sql=neon(db);
  const since=new Date(now.getTime()-WINDOWS[window]).toISOString();
  const p=principalId??null;
  const [sessions,policy,agent,wallets,refunds]=await Promise.all([
    sql.query(SESSIONS_SQL,[p,since]),sql.query(EVENTS_SQL,[p,since,'POLICY_DECISION']),sql.query(EVENTS_SQL,[p,since,'AGENT_RECOMMENDATION']),
    sql.query(WALLETS_SQL,[p]),sql.query(REFUNDS_SQL,[p,since])
  ]) as Record<string,unknown>[][];
  const reasonBySession=new Map<string,string>();
  for(const r of sessions)if(r.overruled)reasonBySession.set(String(r.session_id),codes(r.overrule_reasons));
  const sessionRows:SessionRow[]=await Promise.all(sessions.map(async r=>({
    session_ref:await ref(r.session_id),created_at:iso(r.created_at),status:String(r.status),
    selected_decision:r.selected_decision?String(r.selected_decision):null,connector_id:String(r.connector_id),
    currency:r.product_currency?String(r.product_currency).toUpperCase():null,amount:num(r.product_price),
    wallet_currency:String(r.wallet_currency).toUpperCase(),wallet_amount:num(r.wallet_amount),
    agent_mode:r.agent_mode?String(r.agent_mode):null,agent_overruled:!!r.overruled,
    overrule_reasons:codes(r.overrule_reasons),captured:r.status==='CAPTURED',proof_present:!!r.proof_present
  })));
  const decisionRows:DecisionRow[]=await Promise.all(policy.map(async e=>{const x=payloadOf(e.payload);return {
    session_ref:await ref(e.session_id),decision:String(x.decision??'UNKNOWN'),violations:codes(x.violations),
    presentment_currency:x.presentmentCurrency?String(x.presentmentCurrency).toUpperCase():null,wallet_amount:num(x.walletAmount)};}));
  const agentRows:AgentRow[]=await Promise.all(agent.map(async e=>{const x=payloadOf(e.payload);const sid=String(e.session_id);return {
    session_ref:await ref(sid),mode:String(x.mode??'unknown'),status:String(x.status??'UNKNOWN'),
    overruled:reasonBySession.has(sid),reason_codes:reasonBySession.get(sid)??''};}));
  const walletRows:WalletRow[]=await Promise.all(wallets.map(async w=>{
    const total=Number(w.total_authority),spent=Number(w.spent_amount),reserved=Number(w.reserved_amount??0);
    return {wallet_ref:await ref(w.wallet_id),currency:String(w.currency).toUpperCase(),total_authority:total,spent_amount:spent,reserved_amount:reserved,
      remaining_amount:Math.max(0,Math.round((total-spent-reserved)*100)/100),status:String(w.status),valid_until:iso(w.valid_until)};}));
  const refundRows:RefundRow[]=await Promise.all(refunds.map(async r=>({refund_ref:await ref(r.refund_id),status:String(r.status),amount:Number(r.amount),currency:String(r.currency).toUpperCase(),created_at:iso(r.created_at)})));
  const scope:StudioScope=principalId===undefined?'ALL':'OWN';
  return {generatedAt:now.toISOString(),window,scope,rowCap:ROW_CAP,sources:[
    {id:'sessions',data:sessionRows},{id:'decisions',data:decisionRows},{id:'agent',data:agentRows},{id:'wallets',data:walletRows},{id:'refunds',data:refundRows}]};
}
