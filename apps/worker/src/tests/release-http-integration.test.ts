import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {isolatedDatabase,type IsolatedDatabase} from './isolated-database';
import {createDemoTransport} from '../../../web/app/demo-access';
import {syntheticEnv,syntheticMapping} from './recipient-fixtures';
let db:IsolatedDatabase;
vi.mock('agents',()=>({routeAgentRequest:vi.fn().mockResolvedValue(null)}));
vi.mock('../agent/purchase-agent',()=>({PurchaseAgent:class {}}));
// Infrastructure mock only: financial authority and ownership use actual SQL.
vi.mock('../session-payments/lock',()=>({SessionPaymentLock:class {
 static fromEnv(){return new this();}async claim(){return true;}async release(){}
}}));
vi.mock('@neondatabase/serverless',()=>({neon:()=>{
 const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{let query=parts[0];for(let i=0;i<values.length;i++)query+='$'+(i+1)+parts[i+1];return (await db.query(query,values)).rows;};
 sql.query=async(query:string,values:unknown[])=>(await db.query(query,values)).rows;return sql;
}}));
import worker from '../index';
import type {IntentWallet} from '../wallets/types';
import type {PurchaseSession} from '../sessions/types';
type SessionResponse={session:PurchaseSession};
let env:Record<string,string>,order:Record<string,unknown>|null;
let providerAuthorization:Record<string,unknown>|null,providerCapture:Record<string,unknown>|null,interruptCapture:boolean;
function unit(){return (order!.purchase_units as {amount:object;custom_id:string;payments?:object}[])[0];}
const base='https://worker.test';
const post=(body:unknown):RequestInit=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
function visitor(){
 const data=new Map<string,string>();
 return createDemoTransport(base,{getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:k=>{data.delete(k);}},
  (async(input,init)=>worker.fetch(new Request(String(input),init),env as unknown as Env)) as typeof fetch);
}
async function call<T=unknown>(client:ReturnType<typeof visitor>,path:string,init?:RequestInit){const response=await client.fetch(base+path,init);return {status:response.status,body:await response.json() as T};}
async function wallet(client:ReturnType<typeof visitor>){const r=await call<{wallet:IntentWallet}>(client,'/api/wallets',post({name:'Isolated demo',countryCode:'US',currency:'USD',totalAuthority:100,autoBuyLimit:55,maxSingleTransaction:75,allowedCategories:['electronics'],allowedBrands:['Sony','Bose'],blockedBrands:['Boat'],requiredFeatures:['wireless','ANC'],validUntil:new Date(Date.now()+23*3600000).toISOString()}));expect(r.status).toBe(201);return r.body.wallet;}
async function run(client:ReturnType<typeof visitor>,walletId:string,prompt:string){const r=await call<SessionResponse>(client,'/api/sessions',post({walletId,connectorId:'paypal-demo-marketplace',prompt,channel:'WEB'}));expect(r.status).toBe(201);const result=await call<SessionResponse>(client,`/api/sessions/${r.body.session.sessionId}/run`,post({}));expect(result.status).toBe(200);return result.body;}
beforeAll(async()=>{
 db=await isolatedDatabase();
 const order:string[]=JSON.parse(readFileSync(new URL('../../db/release-order.json',import.meta.url),'utf8'));
 for(const file of order)await db.exec(readFileSync(new URL('../../db/'+file,import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
 await db.exec('TRUNCATE intent_wallets CASCADE; TRUNCATE financial_resource_owners,financial_demo_capabilities,financial_access_rate_limits,financial_access_nonces');
 env={...syntheticEnv,DATABASE_URL:'isolated',DEMO_ACCESS_ENABLED:'true',FX_PROVIDER:'static',PAYMENT_PROVIDER:'paypal',APPROVAL_SIGNING_SECRET:'isolated-release-signing-secret-only',PAYPAL_CLIENT_ID:'isolated',PAYPAL_CLIENT_SECRET:'isolated',PAYPAL_WEBHOOK_ID:'isolated',PAYPAL_RETURN_BASE_URL:'https://frontend.test',PAYPAL_MERCHANT_BINDINGS_JSON:JSON.stringify(['audiohub-sandbox','sony-sandbox-store','premiumaudio-sandbox'].map(catalogSellerId=>({...syntheticMapping,catalogSellerId,mappingId:'isolated-'+catalogSellerId})))};
 order=null;providerAuthorization=null;providerCapture=null;interruptCapture=false;
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);if(!url.startsWith('https://api-m.sandbox.paypal.com/'))throw new Error('UNMOCKED_NETWORK_FORBIDDEN');
  if(url.endsWith('/v1/oauth2/token'))return Response.json({access_token:'isolated-oauth-token'});
  if(url.endsWith('/v2/checkout/orders')&&init?.method==='POST'){
   const sent=JSON.parse(String(init.body));order={...sent,id:'isolated-order',status:'CREATED',links:[{rel:'approve',href:'https://provider.invalid/isolated-approval'}]};return Response.json(order);
  }
  if(url.endsWith('/v2/checkout/orders/isolated-order')&&init?.method==='GET')return Response.json(order);
  if(url.endsWith('/v2/checkout/orders/isolated-order/authorize')&&init?.method==='POST'){
   providerAuthorization={id:'isolated-auth',status:'CREATED',amount:unit().amount};order!.status='COMPLETED';unit().payments={authorizations:[providerAuthorization],captures:[]};return Response.json(order);
  }
  if(url.endsWith('/v2/payments/authorizations/isolated-auth')&&init?.method==='GET')return Response.json(providerAuthorization);
  if(url.endsWith('/v2/payments/authorizations/isolated-auth/capture')&&init?.method==='POST'){
   providerCapture={id:'isolated-capture',status:'COMPLETED',amount:unit().amount,custom_id:unit().custom_id,supplementary_data:{related_ids:{order_id:'isolated-order',authorization_id:'isolated-auth'}}};
   unit().payments={authorizations:[providerAuthorization],captures:[providerCapture]};
   if(interruptCapture)throw new Error('ISOLATED_CAPTURE_RESPONSE_INTERRUPTED');
   return Response.json(providerCapture);
  }
  if(url.endsWith('/v2/payments/captures/isolated-capture')&&init?.method==='GET')return Response.json(providerCapture);
  if(url.endsWith('/v1/notifications/verify-webhook-signature')&&init?.method==='POST')return Response.json({verification_status:'SUCCESS'});
  throw new Error('UNMOCKED_PROVIDER_MUTATION_FORBIDDEN');
 }));
});

async function captureFlow(){
 const client=visitor(),w=await wallet(client),result=await run(client,w.walletId,'Find Sony WH-CH720N wireless ANC headphones');
 const path=`/api/sessions/${result.session.sessionId}`;
 expect((await call(client,path+'/payment',post({}))).status).toBe(200);order!.status='APPROVED';
 expect((await call(client,path+'/payment/authorize',post({}))).status).toBe(200);
 return {client,path};
}
async function deliverCapture(){
 return worker.fetch(new Request(base+'/webhooks/paypal',{...post({id:'isolated-event',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:providerCapture}),headers:{'content-type':'application/json','paypal-transmission-id':'isolated','paypal-transmission-time':new Date().toISOString(),'paypal-cert-url':'https://provider.invalid/isolated-cert','paypal-auth-algo':'SHA256withRSA','paypal-transmission-sig':'isolated-mocked-signature'}}),env as unknown as Env);
}
afterAll(async()=>{vi.unstubAllGlobals();await db?.close();});
describe('frontend capability transport through exported Worker and complete release schema',()=>{
 it('authorizes, captures, authenticates a mocked webhook and verifies a real signed proof without duplicate debit',async()=>{
  const {client,path}=await captureFlow();
  expect((await call(client,path+'/payment/capture',post({}))).status).toBe(200);
  expect((await db.query('SELECT * FROM wallet_spend_ledger')).rows).toHaveLength(0);
  expect((await deliverCapture()).status).toBe(200);expect((await deliverCapture()).status).toBe(200);
  const proof=await call<{verification:{verified:boolean;signatureValid:boolean;recipientVerified:boolean}}>(client,path+'/proof');
  expect(proof.status).toBe(200);expect(proof.body.verification.verified).toBe(true);expect(proof.body.verification.recipientVerified).toBe(true);
  expect((await db.query('SELECT * FROM wallet_spend_ledger')).rows).toHaveLength(1);
  expect((await db.query('SELECT spent_amount::text,reserved_amount::text FROM intent_wallets')).rows[0]).toEqual({spent_amount:'49.00',reserved_amount:'0'});
 });
 it('retains ambiguous capture authority and recovers by verified webhook without repeating the provider capture',async()=>{
  const {client,path}=await captureFlow();interruptCapture=true;
  expect((await call(client,path+'/payment/capture',post({}))).status).toBe(409);
  expect((await db.query('SELECT state FROM wallet_authority_reservations')).rows[0].state).toBe('RECONCILIATION_REQUIRED');
  expect((await db.query('SELECT spent_amount::text,reserved_amount::text FROM intent_wallets')).rows[0]).toEqual({spent_amount:'0.00',reserved_amount:'49'});
  expect((await deliverCapture()).status).toBe(200);
  expect((await call<{verification:{verified:boolean}}>(client,path+'/proof')).body.verification.verified).toBe(true);
  expect(vi.mocked(fetch).mock.calls.filter(([url,init])=>String(url).endsWith('/isolated-auth/capture')&&init?.method==='POST')).toHaveLength(1);
 });
 it('bootstraps without signup, binds real discovery to a mocked checkout and withholds unearned proof',async()=>{
  const client=visitor(),w=await wallet(client);expect(w.reservedAmount).toBe(0);
  const result=await run(client,w.walletId,'Find Sony WH-CH720N wireless ANC headphones');
  expect(result.session.selectedDecision).toBe('ALLOW');expect(result.session.selectedProduct!.authorizationContext!.recipient!.catalogSellerId).toBe('audiohub-sandbox');
  const path=`/api/sessions/${result.session.sessionId}`;
  const prepared=await call<{payment:{providerOrderId:string}}>(client,path+'/payment',post({}));expect(prepared.status).toBe(200);
  expect(prepared.body.payment.providerOrderId).toBe('isolated-order');
  expect((await call<{wallets:IntentWallet[]}>(client,'/api/wallets')).body.wallets[0].reservedAmount).toBe(49);
  expect((await call(client,path+'/proof')).status).toBe(404);
  expect((await db.query('SELECT * FROM wallet_spend_ledger')).rows).toHaveLength(0);
  const retry=await call<{duplicate:boolean}>(client,path+'/payment',post({}));expect(retry.body.duplicate).toBe(true);
  expect((await db.query('SELECT * FROM wallet_authority_reservations')).rows).toHaveLength(1);
 });
 it('uses the backend Bose step-up and resolves one-time authority through the same capability',async()=>{
  const client=visitor(),w=await wallet(client),result=await run(client,w.walletId,'Find Bose QuietComfort wireless ANC headphones');
  expect(result.session.selectedDecision).toBe('STEP_UP');expect(result.session.selectedProduct!.brand).toBe('Bose');
  const resolved=await call<SessionResponse>(client,`/api/sessions/${result.session.sessionId}/step-up/resolve`,post({action:'ALLOW_ONCE'}));
  expect(resolved.status).toBe(200);expect(resolved.body.session.status).toBe('READY_TO_PAY');
  expect((await db.query('SELECT * FROM wallet_one_time_authorizations')).rows).toHaveLength(1);
 });
 it('keeps Boat blocked and foreign visitors unable to read or prepare the session',async()=>{
  const a=visitor(),w=await wallet(a),result=await run(a,w.walletId,'Find Boat Nirvana ANC wireless headphones');
  expect(result.session.selectedDecision).toBe('BLOCK');
  const b=visitor(),path=`/api/sessions/${result.session.sessionId}`;
  expect((await call(b,path)).status).toBe(404);expect((await call(b,path+'/payment',post({ownerId:'demo:forged'}))).status).toBe(404);
  expect((await call<{wallets:IntentWallet[]}>(b,'/api/wallets')).body.wallets).toEqual([]);expect(fetch).not.toHaveBeenCalled();
 });
 it('fails closed before provider mutation when the current merchant registry is removed',async()=>{
  const client=visitor(),w=await wallet(client),result=await run(client,w.walletId,'Find Sony WH-CH720N wireless ANC headphones');
  env.PAYPAL_MERCHANT_BINDINGS_JSON='[]';
  expect((await call(client,`/api/sessions/${result.session.sessionId}/payment`,post({}))).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();expect((await db.query('SELECT * FROM wallet_authority_reservations')).rows).toHaveLength(0);
 });
});
