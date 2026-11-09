import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {isolatedDatabase,type IsolatedDatabase} from './isolated-database';
import {readFileSync} from 'node:fs';
import {ACCESS_CONTEXT} from '../access/identity';
import {handleControlStudioRoutes} from '../control-studio/routes';
import {LIST_WALLETS_SQL} from '../wallets/repository';
let db:IsolatedDatabase;
vi.mock('@neondatabase/serverless',()=>({neon:()=>{
 const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{let query=parts[0];for(let i=0;i<values.length;i++)query+='$'+(i+1)+parts[i+1];return (await db.query(query,values)).rows;};
 sql.query=async(query:string,values:unknown[])=> (await db.query(query,values)).rows;return sql;
}}));

const RAW=['wallet-a','wallet-b','wallet-g','sess-a1','sess-a2','sess-b1','sess-old','sess-g1','refund-a1','refund-b1'];
const identity=(kind:'demo'|'api'|'ops',principalId:string)=>({kind,principalId,scopes:['financial:read']});
const call=async(who:ReturnType<typeof identity>|undefined,qs='')=>{
 const env:any={DATABASE_URL:'isolated',...(who?{[ACCESS_CONTEXT]:who}:{})};
 const res=await handleControlStudioRoutes(new Request('https://x.test/api/control-studio/dataset'+qs),env,new URL('https://x.test/api/control-studio/dataset'+qs));
 const text=await res!.text();return {status:res!.status,text,body:JSON.parse(text)};
};
const src=(body:any,id:string):any[]=>body.sources.find((s:any)=>s.id===id).data;

async function seedSession(id:string,wallet:string,opts:{status?:string;age?:string;overrule?:string[];decision?:string;mode?:string}={}){
 await db.query(`INSERT INTO purchase_sessions(session_id,wallet_id,user_prompt,status,selected_product,selected_decision,created_at)
  VALUES($1,$2,'private prompt text',$3,$4::jsonb,'ALLOW',NOW()-$5::interval)`,[id,wallet,opts.status??'READY_TO_PAY',JSON.stringify({id:'p',price:49,currency:'USD',merchant:'secret-merchant'}),opts.age??'1 hour']);
 const ev=(type:string,payload:object)=>db.query(`INSERT INTO purchase_session_events(event_id,session_id,event_type,payload) VALUES($1,$2,$3,$4::jsonb)`,[crypto.randomUUID(),id,type,JSON.stringify(payload)]);
 await ev('POLICY_DECISION',{productId:'p',title:'t',decision:opts.decision??'ALLOW',violations:opts.decision==='BLOCK'?['BRAND_BLOCKED']:[],presentmentAmount:49,presentmentCurrency:'USD',walletAmount:49,walletCurrency:'USD'});
 await ev('AGENT_RECOMMENDATION',{mode:opts.mode??'simulated',status:'OK',rationale:'free text that must not leak'});
 await ev('CANDIDATE_SELECTED',{productId:'p',walletAmount:49,walletCurrency:'USD'});
 if(opts.overrule)await ev('AGENT_RECOMMENDATION_OVERRULED',{overruleReasons:opts.overrule,selectedProductId:'p'});
}

beforeAll(async()=>{
 db=await isolatedDatabase();
 const order:string[]=JSON.parse(readFileSync(new URL('../../db/release-order.json',import.meta.url),'utf8'));
 for(const file of order)await db.exec(readFileSync(new URL('../../db/'+file,import.meta.url),'utf8'));
},60000);
beforeEach(async()=>{
 await db.exec(`TRUNCATE intent_wallets,financial_resource_owners,financial_wallet_grants CASCADE;
 INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,spent_amount,auto_buy_limit,max_single_transaction,valid_until) VALUES
 ('wallet-a','A','USD',100,20,55,75,NOW()+INTERVAL '1 day'),('wallet-b','B','USD',100,0,55,75,NOW()+INTERVAL '1 day'),('wallet-g','G','USD',100,0,55,75,NOW()+INTERVAL '1 day');
 INSERT INTO financial_resource_owners(resource_type,resource_id,principal_id) VALUES('wallet','wallet-a','demo:a'),('wallet','wallet-b','demo:b');
 INSERT INTO financial_wallet_grants(wallet_id,principal_id,permissions,expires_at,granted_by) VALUES('wallet-g','api:client-1',ARRAY['read'],NOW()+INTERVAL '1 day','ops');`);
 await seedSession('sess-a1','wallet-a',{status:'CAPTURED',overrule:['RECOMMENDED_CANDIDATE_BLOCK','BRAND_BLOCKED']});
 await seedSession('sess-a2','wallet-a',{decision:'BLOCK',status:'BLOCKED'});
 await seedSession('sess-b1','wallet-b');
 await seedSession('sess-g1','wallet-g');
 await seedSession('sess-old','wallet-a',{age:'10 days'});
 await db.query(`INSERT INTO session_refunds(refund_id,session_id,wallet_id,provider,provider_capture_id,idempotency_key,reason,amount,currency,wallet_credit_amount,wallet_credit_currency,status)
  VALUES('refund-a1','sess-a1','wallet-a','paypal','cap-secret',$1,'r',10,'USD',10,'USD','COMPLETED'),('refund-b1','sess-b1','wallet-b','paypal','cap-b',$2,'r',5,'USD',5,'USD','REQUESTED')`,['a'.repeat(64),'b'.repeat(64)]);
});
afterAll(async()=>{await db?.close();});

describe('control studio dataset',()=>{
 it('returns the AG Studio sources contract',async()=>{
  const {status,body}=await call(identity('demo','demo:a'));
  expect(status).toBe(200);
  expect(body.scope).toBe('OWN');expect(body.window).toBe('7d');expect(typeof body.generatedAt).toBe('string');
  expect(body.sources.map((s:any)=>s.id)).toEqual(['sessions','decisions','agent','wallets','refunds']);
  for(const s of body.sources){expect(Array.isArray(s.data)).toBe(true);for(const row of s.data)for(const v of Object.values(row))expect(['string','number','boolean'].includes(typeof v)||v===null).toBe(true);}
  const sessions=src(body,'sessions');
  expect(Object.keys(sessions[0]).sort()).toEqual(['agent_mode','agent_overruled','amount','captured','connector_id','created_at','currency','overrule_reasons','proof_present','selected_decision','session_ref','status','wallet_amount','wallet_currency'].sort());
  const captured=sessions.find((r:any)=>r.captured);
  expect(captured).toMatchObject({agent_overruled:true,overrule_reasons:'RECOMMENDED_CANDIDATE_BLOCK,BRAND_BLOCKED',amount:49,wallet_amount:49,wallet_currency:'USD',agent_mode:'simulated',proof_present:false});
  expect(src(body,'decisions').map((d:any)=>d.decision).sort()).toEqual(['ALLOW','BLOCK']);
  expect(src(body,'decisions').find((d:any)=>d.decision==='BLOCK').violations).toBe('BRAND_BLOCKED');
  expect(src(body,'agent').filter((a:any)=>a.overruled)).toHaveLength(1);
  expect(src(body,'wallets')[0]).toMatchObject({total_authority:100,spent_amount:20,reserved_amount:0,remaining_amount:80});
 });
 it('scopes principals to their own wallets and rows, ops sees everything',async()=>{
  const a=await call(identity('demo','demo:a')),b=await call(identity('demo','demo:b'));
  expect(src(a.body,'sessions')).toHaveLength(2);expect(src(a.body,'wallets')).toHaveLength(1);expect(src(a.body,'refunds')).toHaveLength(1);
  expect(src(b.body,'sessions')).toHaveLength(1);expect(src(b.body,'wallets')).toHaveLength(1);expect(src(b.body,'refunds')[0].status).toBe('REQUESTED');
  const refsA=new Set(src(a.body,'sessions').map((r:any)=>r.session_ref));
  for(const r of src(b.body,'sessions'))expect(refsA.has(r.session_ref)).toBe(false);
  const api=await call(identity('api','api:client-1'));
  expect(src(api.body,'sessions')).toHaveLength(1);expect(api.body.scope).toBe('OWN');
  const none=await call(identity('demo','demo:nobody'));
  expect(none.body.sources.every((s:any)=>s.data.length===0)).toBe(true);
  const ops=await call(identity('ops','ops:admin'));
  expect(ops.body.scope).toBe('ALL');expect(src(ops.body,'sessions')).toHaveLength(4);expect(src(ops.body,'wallets')).toHaveLength(3);expect(src(ops.body,'refunds')).toHaveLength(2);
 });
 it('wallet scope matches GET /api/wallets listing for the same principal',async()=>{
  for(const p of ['demo:a','demo:b','api:client-1','demo:nobody']){
   const listed=(await db.query<any>(LIST_WALLETS_SQL,[p])).rows.length;
   const {body}=await call(identity(p.startsWith('api')?'api':'demo',p));expect(src(body,'wallets')).toHaveLength(listed);
  }
 });
 it('never leaks raw ids, prompts, free text or provider references',async()=>{
  for(const who of [identity('ops','ops:admin'),identity('demo','demo:a')]){
   const {text,body}=await call(who);
   for(const raw of RAW)expect(text).not.toContain(raw);
   for(const s of ['private prompt text','free text that must not leak','secret-merchant','cap-secret','demo:a','api:client-1'])expect(text).not.toContain(s);
   for(const r of src(body,'sessions'))expect(r.session_ref).toMatch(/^[0-9a-f]{8}$/);
   for(const r of src(body,'wallets'))expect(r.wallet_ref).toMatch(/^[0-9a-f]{8}$/);
  }
 });
 it('filters by window',async()=>{
  const d7=await call(identity('demo','demo:a'),'?window=7d'),d30=await call(identity('demo','demo:a'),'?window=30d');
  expect(src(d7.body,'sessions')).toHaveLength(2);expect(src(d30.body,'sessions')).toHaveLength(3);expect(d30.body.window).toBe('30d');
  await db.query(`UPDATE purchase_sessions SET created_at=NOW()-INTERVAL '2 hours' WHERE session_id='sess-a2'`);
  await db.query(`UPDATE purchase_sessions SET created_at=NOW()-INTERVAL '30 hours' WHERE session_id='sess-a1'`);
  const h24=await call(identity('demo','demo:a'),'?window=24h');
  expect(src(h24.body,'sessions')).toHaveLength(1);
 });
 it('rejects bad windows, unauthenticated callers and writes; stays read-only',async()=>{
  expect((await call(identity('demo','demo:a'),'?window=1y')).status).toBe(400);
  expect((await call(undefined)).status).toBe(401);
  const env:any={DATABASE_URL:'isolated',[ACCESS_CONTEXT]:identity('ops','ops:admin')};
  const post=await handleControlStudioRoutes(new Request('https://x.test/api/control-studio/dataset',{method:'POST'}),env,new URL('https://x.test/api/control-studio/dataset'));
  expect(post!.status).toBe(404);
  expect(await handleControlStudioRoutes(new Request('https://x.test/api/wallets'),env,new URL('https://x.test/api/wallets'))).toBeNull();
  const before=(await db.query<any>('SELECT spent_amount::text s,reserved_amount::text r FROM intent_wallets ORDER BY wallet_id')).rows;
  await call(identity('ops','ops:admin'));
  expect((await db.query<any>('SELECT spent_amount::text s,reserved_amount::text r FROM intent_wallets ORDER BY wallet_id')).rows).toEqual(before);
 });
});
