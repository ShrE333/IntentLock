import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {isolatedDatabase,type IsolatedDatabase} from './isolated-database';
import {SessionPaymentLock,sessionPaymentLockMode} from '../session-payments/lock';
import {safePaymentFailure} from '../session-payments/safe-errors';
import {paypalReadiness} from '../session-payments/readiness';
import {createPaymentForSession} from '../session-payments/service';
import * as providers from '../session-payments/providers';
import {assertTrustedRecipient} from '../payments/recipient-binding';
import {syntheticBinding,syntheticEnv,syntheticMerchant} from './recipient-fixtures';
import {getPayPalRecipientFacts} from '../session-payments/providers/paypal';

// The demo Worker ran without Upstash Redis, so every checkout threw
// UPSTASH_REDIS_NOT_CONFIGURED, surfaced as the generic PAYMENT_OPERATION_FAILED.
// These tests run the real lock and real reservation SQL; only external systems are stubbed.
let db:IsolatedDatabase;
vi.mock('@neondatabase/serverless',()=>({neon:()=>{
 const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{let query=parts[0];for(let i=0;i<values.length;i++)query+='$'+(i+1)+parts[i+1];return (await db.query(query,values)).rows;};
 sql.query=async(query:string,values:unknown[])=> (await db.query(query,values)).rows;return sql;
}}));
vi.mock('../session-payments/audit',()=>({appendSessionAuditEvent:vi.fn(),mirrorSessionTraceToAudit:vi.fn()}));
vi.mock('../sessions/repository',()=>({getSession:vi.fn(async()=>session),addEvent:vi.fn()}));
vi.mock('../wallets/repository',()=>({getWallet:vi.fn(async()=>wallet)}));
vi.mock('../commerce/registry',()=>({getCommerceConnectors:()=>[{info:()=>({id:session.connectorId}),getProduct:async()=>({...product})}]}));
vi.mock('../risk/tighten',()=>({assessAndTighten:vi.fn(async(_db,_input,evaluation)=>({evaluation,assessment:{riskAction:'OBSERVE'}}))}));
// Real recipient evidence: only the PayPal order read is a fixture.
vi.mock('../session-payments/providers/paypal',async original=>({...await original<typeof import('../session-payments/providers/paypal')>(),getPayPalRecipientFacts:vi.fn()}));
vi.mock('../payments/recipient-binding',async original=>({...await original<typeof import('../payments/recipient-binding')>(),assertTrustedRecipient:vi.fn()}));
vi.mock('../session-payments/providers',()=>({selectPaymentProvider:vi.fn(),createProviderCheckout:vi.fn()}));

const env={...syntheticEnv,DATABASE_URL:'isolated',APPROVAL_SIGNING_SECRET:'isolated-test-secret-0123456789'};
const product={id:'pp_sony_49',title:'Sony headphones',price:49,currency:'USD',brand:'Sony',category:'electronics',merchant:'demo',quantityAvailable:1,features:[]};
const wallet={walletId:'w',currency:'USD',totalAuthority:100,spentAmount:0,autoBuyLimit:55,maxSingleTransaction:75,allowedCategories:[],allowedBrands:[],blockedBrands:[],requiredFeatures:[],validUntil:'2099-01-01T00:00:00.000Z',status:'ACTIVE'};
const session={sessionId:'s',walletId:'w',status:'READY_TO_PAY',connectorId:'paypal-demo-marketplace',selectedProduct:{...product},selectedDecision:'ALLOW',authorizationId:null};
const checkout={provider:'paypal',providerOrderId:'order-1',referenceId:null,checkoutUrl:'https://provider.invalid/approve',status:'CREATED',expiresAt:'2099-01-01T00:00:00Z'};

beforeAll(async()=>{
 db=await isolatedDatabase();
 const order:string[]=JSON.parse(readFileSync(new URL('../../db/release-order.json',import.meta.url),'utf8'));
 for(const file of order)await db.exec(readFileSync(new URL('../../db/'+file,import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
 vi.clearAllMocks();
 // The SQL trigger requires the payment's recipient to equal the session's bound recipient.
 const binding=await syntheticBinding();
 vi.mocked(assertTrustedRecipient).mockResolvedValue(binding);
 await db.exec(`TRUNCATE intent_wallets CASCADE;
 INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,auto_buy_limit,max_single_transaction,valid_until) VALUES('w','wallet','USD',100,55,75,NOW()+INTERVAL '1 day');`);
 await db.query(`INSERT INTO purchase_sessions(session_id,wallet_id,user_prompt,status,selected_product,selected_decision) VALUES('s','w','test','READY_TO_PAY',$1::jsonb,'ALLOW')`,[JSON.stringify({...product,authorizationContext:{recipient:binding}})]);
 vi.mocked(providers.selectPaymentProvider).mockReturnValue({provider:'paypal',selected:{},evaluated:[]} as any);
 vi.mocked(providers.createProviderCheckout).mockResolvedValue(checkout as any);
 vi.mocked(getPayPalRecipientFacts).mockResolvedValue({order:{id:'order-1',intent:'AUTHORIZE',status:'CREATED',purchase_units:[{reference_id:'s',custom_id:'s',payee:{merchant_id:syntheticMerchant},amount:{value:'49.00',currency_code:'USD'},payments:{authorizations:[],captures:[]}}]},authorization:null,capture:null} as any);
});
afterAll(async()=>{await db?.close();});

describe('session payment execution lock',()=>{
 it('uses PostgreSQL admission when Redis is absent and Redis only when fully configured',async()=>{
  expect(sessionPaymentLockMode({})).toBe('DATABASE_ADMISSION');
  expect(sessionPaymentLockMode({UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'t'})).toBe('REDIS');
  const lock=SessionPaymentLock.fromEnv({UPSTASH_REDIS_REST_URL:' ',UPSTASH_REDIS_REST_TOKEN:''});
  expect(lock.mode).toBe('DATABASE_ADMISSION');
  expect(await lock.claim('k','v')).toBe(true);
  await expect(lock.release('k')).resolves.toBeUndefined();
 });
 it('fails closed on a half-configured Redis',()=>{
  expect(()=>SessionPaymentLock.fromEnv({UPSTASH_REDIS_REST_URL:'https://redis.invalid'})).toThrow('UPSTASH_REDIS_PARTIALLY_CONFIGURED');
  expect(()=>SessionPaymentLock.fromEnv({UPSTASH_REDIS_REST_TOKEN:'t'})).toThrow('UPSTASH_REDIS_PARTIALLY_CONFIGURED');
 });
 it('readiness reports the lock mode and flags half-configured Redis',()=>{
  expect(paypalReadiness({}).executionLock).toBe('DATABASE_ADMISSION');
  const partial=paypalReadiness({UPSTASH_REDIS_REST_URL:'https://redis.invalid'});
  expect(partial.executionLock).toBe('MISCONFIGURED');
  expect(partial.issues).toContain('UPSTASH_REDIS_PARTIALLY_CONFIGURED');
 });
});

describe('checkout creation without Redis',()=>{
 it('creates exactly one PayPal order and reserves exact authority',async()=>{
  const result=await createPaymentForSession(env,'s');
  expect(result.duplicate).toBe(false);
  expect(providers.createProviderCheckout).toHaveBeenCalledTimes(1);
  const r=(await db.query<any>("SELECT state,phase,provider_order_id,amount::float8 AS amount FROM wallet_authority_reservations WHERE session_id='s'")).rows[0];
  expect(r).toEqual({state:'RESERVED',phase:'CHECKOUT',provider_order_id:'order-1',amount:49});
  const s=(await db.query<any>("SELECT status FROM purchase_sessions WHERE session_id='s'")).rows[0];
  expect(s.status).toBe('PAYPAL_APPROVAL_PENDING');
 });
 it('a concurrent duplicate is rejected by SQL admission before any second provider call',async()=>{
  let entered!:()=>void;const providerEntered=new Promise<void>(r=>{entered=r;});
  let open!:()=>void;const gate=new Promise<void>(r=>{open=r;});
  vi.mocked(providers.createProviderCheckout).mockImplementation(async()=>{entered();await gate;return checkout as any;});
  const first=createPaymentForSession(env,'s');
  await providerEntered;
  // The first request is now inside the provider call, holding the CHECKOUT admission.
  const second=await createPaymentForSession(env,'s').then(()=>null,(e:unknown)=>e);
  expect(second).toBeInstanceOf(Error);
  expect(safePaymentFailure(second).code).toBe('RESERVATION_NOT_EXECUTABLE');
  open();
  await expect(first).resolves.toMatchObject({duplicate:false});
  expect(providers.createProviderCheckout).toHaveBeenCalledTimes(1);
  const w=(await db.query<any>("SELECT reserved_amount::float8 AS reserved,spent_amount::float8 AS spent FROM intent_wallets WHERE wallet_id='w'")).rows[0];
  expect(w).toEqual({reserved:49,spent:0});
  const link=(await db.query<any>("SELECT provider_order_id,status FROM session_payment_links WHERE session_id='s'")).rows[0];
  expect(link).toEqual({provider_order_id:'order-1',status:'CREATED'});
 });
 it('a retry after success returns the existing order without a provider call',async()=>{
  await createPaymentForSession(env,'s');
  const again=await createPaymentForSession(env,'s');
  expect(again.duplicate).toBe(true);
  expect(providers.createProviderCheckout).toHaveBeenCalledTimes(1);
 });
});

describe('payment failure vocabulary',()=>{
 it.each([
  'SESSION_PAYMENT_ALREADY_IN_PROGRESS','COMMERCE_QUOTE_CHANGED_REAUTHORIZE','WALLET_EXPIRES_TOO_SOON_FOR_PAYMENT',
  'RESERVATION_NOT_EXECUTABLE','WALLET_AVAILABLE_AUTHORITY_EXCEEDED','COMMERCE_DISCOVERY_ONLY','UPSTASH_REDIS_PARTIALLY_CONFIGURED'
 ])('reports %s instead of the generic failure',code=>{
  expect(safePaymentFailure(new Error(code))).toEqual({code,message:code});
 });
 it('drops runtime detail from prefixed codes',()=>{
  expect(safePaymentFailure(new Error('SESSION_NOT_READY_TO_PAY:AWAITING_STEP_UP')).code).toBe('SESSION_NOT_READY_TO_PAY');
  expect(safePaymentFailure(new Error('AUTHORITY_CHANGED:BRAND_BLOCKED,AMOUNT_OVER_LIMIT'))).toEqual({code:'AUTHORITY_CHANGED',message:'AUTHORITY_CHANGED'});
  expect(safePaymentFailure(new Error('PAYPAL_CAPTURE_AMOUNT_MISMATCH:48:49')).code).toBe('PAYPAL_CAPTURE_AMOUNT_MISMATCH');
 });
 it('unwraps a known code raised through a driver prefix only',()=>{
  expect(safePaymentFailure(new Error('error: RESERVATION_TERMINAL')).code).toBe('RESERVATION_TERMINAL');
  expect(safePaymentFailure(new Error('error: SECRET_VALUE')).code).toBe('PAYMENT_OPERATION_FAILED');
  expect(safePaymentFailure(new Error('AUTHORITY_CHANGEDX')).code).toBe('PAYMENT_OPERATION_FAILED');
 });
});
