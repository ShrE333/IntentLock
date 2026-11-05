import {describe,it,expect,vi,afterEach} from 'vitest';
// @ts-expect-error Node operator ESM, intentionally not bundled into Worker.
import {runSandbox,validateBuyerReturn,validateSettlementProof} from '../../scripts/paypal-sandbox-e2e.mjs';
// @ts-expect-error Node operator ESM.
import {verifySandboxOAuth,readJson,sourceModule} from '../../scripts/sandbox-tools.mjs';
// @ts-expect-error Node operator ESM.
import {safeDiagnostic,SafeSandboxError} from '../../scripts/sandbox-diagnostics.mjs';
import {safePaymentFailure} from '../session-payments/safe-errors';
const env={PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'isolated-client',PAYPAL_CLIENT_SECRET:'isolated-secret'};
const buyerReturn='https://intentlock-web.vercel.app/new-purchase?paypal=approved&sessionId=s&token=o&PayerID=buyer';
function proof(){return {receipt:{receiptId:'r',payload:{session:{sessionId:'s'},wallet:{walletId:'w'},
 payment:{provider:'paypal',providerOrderId:'o',amount:49,currency:'USD',webhookSignatureVerified:true,capturedStateSource:'VERIFIED_PROVIDER_WEBHOOK'},
 walletSpend:{ledgerId:'ledger',amount:49,currency:'USD'}}},verification:{verified:true,signatureValid:true,recipientVerified:true}};}
function harness(overrides:Record<string,any>={}){
 const calls:string[]=[];const logs:string[]=[];let captures=0;
 const request=vi.fn(async(url:string)=>{
  const path=new URL(url).pathname;calls.push(path);
  if(path in overrides){const value=overrides[path];if(value instanceof Error)throw value;return value;}
  if(path==='/api/payments/provider')return {paypalEnvironment:'sandbox',paypalReadiness:{ready:true}};
  if(path==='/api/access/demo')return {token:'ildemo_'+'a'.repeat(64),expiresAt:new Date(Date.now()+30*60000).toISOString()};
  if(path==='/api/wallets')return calls.filter(p=>p==='/api/wallets').length===1?{wallet:{walletId:'w'}}:{wallets:[{walletId:'w',spentAmount:49,reservedAmount:0}]};
  if(path==='/api/sessions')return {session:{sessionId:'s'}};
  if(path.endsWith('/run'))return {session:{sessionId:'s',selectedDecision:'ALLOW',selectedProduct:{id:'pp_sony_49',price:49,currency:'USD',authorizationContext:{recipient:{environment:'sandbox',provider:'paypal',connectorId:'paypal-demo-marketplace',fingerprint:'synthetic',validUntil:new Date(Date.now()+3600000).toISOString()}}}}};
  if(path.endsWith('/authorize'))return {ok:true};
  if(path.endsWith('/capture'))return {duplicate:++captures>1};
  if(path.endsWith('/proof'))return proof();
  if(path.endsWith('/payment'))return {payment:{provider:'paypal',amount:49,currency:'USD',providerOrderId:'o',checkoutUrl:'https://www.sandbox.paypal.com/checkoutnow?token=o'},reservation:{state:'COMMITTED'}};
  if(path==='/api/sessions/s')return {session:{status:'CAPTURED'}};
  throw new Error('unexpected test route');
 });
 const answers=['SANDBOX',buyerReturn,'AUTHORIZE','CAPTURE 49.00 USD','REPLAY'];
 const options={request,question:vi.fn(async()=>answers.shift()),log:(s:string)=>logs.push(s),configCheck:vi.fn(),interactive:true,sleep:vi.fn(),attempts:2};
 return {options,calls,logs,request};
}
afterEach(()=>vi.unstubAllGlobals());
describe('sandbox runner isolated regressions (no real provider or database)',()=>{
 it('stops before any request on invalid demo resources',async()=>{
  const h=harness();h.options.configCheck.mockRejectedValue(new Error('DEMO_QUEUE_ISOLATION_INVALID'));
  const out=await runSandbox(h.options);expect(out.diagnostic).toEqual({stage:'configuration',code:'DEMO_QUEUE_ISOLATION_INVALID'});expect(h.calls).toEqual([]);
 });
 it('never acquires capability without explicit operator confirmation',async()=>{
  const h=harness();h.options.question.mockResolvedValue('no');const out=await runSandbox(h.options);
  expect(out.diagnostic.stage).toBe('operator_confirmation');expect(h.calls).toEqual(['/api/payments/provider']);
 });
 it.each([undefined,'wrong','ildemo_'+'z'.repeat(64)])('rejects missing/incorrect capability %s',async token=>{
  const h=harness({'/api/access/demo':{token,expiresAt:new Date(Date.now()+60000).toISOString()}});
  expect((await runSandbox(h.options)).diagnostic).toEqual({stage:'demo_capability',code:'CAPABILITY_INVALID'});
  expect(h.calls).not.toContain('/api/wallets');
 });
 it('rejects expired capability before creating wallet',async()=>{
  const h=harness({'/api/access/demo':{token:'ildemo_'+'a'.repeat(64),expiresAt:'2000-01-01'}});
  expect((await runSandbox(h.options)).diagnostic.code).toBe('CAPABILITY_EXPIRED');expect(h.calls).not.toContain('/api/wallets');
 });
 it.each([401,403,503])('reports pre-OAuth capability HTTP %i without secrets',async status=>{
  const h=harness({'/api/access/demo':new SafeSandboxError('HTTP_ERROR',status)});
  const out=await runSandbox(h.options);expect(out.diagnostic).toEqual({stage:'demo_capability',code:'HTTP_ERROR',status});expect(out.results.oauth).toBe('NOT_TESTED');
 });
 it.each([401,403])('distinguishes provider OAuth rejection %i during checkout from capability failure',async providerStatus=>{
  const error=new SafeSandboxError('PAYPAL_OAUTH_REJECTED',409);error.providerStatus=providerStatus;
  const h=harness({'/api/sessions/s/payment':error});const out=await runSandbox(h.options);
  expect(out.diagnostic).toEqual({stage:'checkout_order',code:'PAYPAL_OAUTH_REJECTED',status:409,providerStatus});
  expect(out.results.oauth).toBe('WORKER_OAUTH_NOT_INDEPENDENTLY_OBSERVED');
  expect(h.calls.some(p=>p.endsWith('/authorize')||p.endsWith('/capture'))).toBe(false);
 });
 it.each([null,{environment:'sandbox',validUntil:'2000-01-01'}])('blocks missing/expired recipient before order',async recipient=>{
  const h=harness({'/api/sessions/s/run':{session:{sessionId:'s',selectedDecision:'ALLOW',selectedProduct:{id:'pp_sony_49',price:49,currency:'USD',authorizationContext:{recipient}}}}});
  expect((await runSandbox(h.options)).diagnostic.code).toBe('TRUSTED_RECIPIENT_REQUIRED');expect(h.calls).not.toContain('/api/sessions/s/payment');
 });
 it.each(['https://evil.example/?token=o',buyerReturn.replace('token=o','token=wrong'),buyerReturn.replace('approved','cancelled'),buyerReturn+'&token=o',buyerReturn.replace('sessionId=s','sessionId=other')])('rejects invalid buyer return',value=>{
  expect(()=>validateBuyerReturn(value,'s','o')).toThrow('INVALID_BUYER_RETURN');
 });
 it('does not authorize after invalid buyer return',async()=>{
  const h=harness();h.options.question.mockResolvedValueOnce('SANDBOX').mockResolvedValueOnce('invalid');
  expect((await runSandbox(h.options)).diagnostic.stage).toBe('buyer_approval');expect(h.calls.some(p=>p.endsWith('/authorize'))).toBe(false);
 });
 it('requires explicit capture confirmation',async()=>{
  const h=harness();h.options.question.mockResolvedValueOnce('SANDBOX').mockResolvedValueOnce(buyerReturn).mockResolvedValueOnce('AUTHORIZE').mockResolvedValueOnce('no');
  expect((await runSandbox(h.options)).diagnostic.stage).toBe('capture_confirmation');expect(h.calls.some(p=>p.endsWith('/capture'))).toBe(false);
 });
 it('does not retry ambiguous capture',async()=>{
  const h=harness({'/api/sessions/s/payment/capture':new Error('credential-bearing failure')});
  const out=await runSandbox(h.options);expect(out.results.capture).toBe('REQUEST_STARTED_OUTCOME_UNKNOWN');expect(h.calls.filter(p=>p.endsWith('/capture'))).toHaveLength(1);
  expect(h.logs.join('')).not.toContain('credential-bearing');
 });
 it('times out accepted capture without settlement and never recaptures',async()=>{
  const h=harness({'/api/sessions/s':{session:{status:'CAPTURE_PENDING'}}});
  const out=await runSandbox(h.options);expect(out.diagnostic.code).toBe('WEBHOOK_OR_QUEUE_TIMEOUT');expect(out.results.capture).toBe('REQUEST_ACCEPTED_NOT_SETTLED');expect(h.calls.filter(p=>p.endsWith('/capture'))).toHaveLength(1);
 });
 it('rejects missing verified webhook even with otherwise valid proof',async()=>{
  const p=proof();p.receipt.payload.payment.webhookSignatureVerified=false;
  expect(()=>validateSettlementProof(p,'s','w','o')).toThrow('MISSING_VERIFIED_WEBHOOK');
  const h=harness({'/api/sessions/s/proof':p});expect((await runSandbox(h.options)).ok).toBe(false);
 });
 it('observes one ledger identity after duplicate capture; leaves queue and webhook replay pending',async()=>{
  const h=harness();const out=await runSandbox(h.options);expect(out.ok).toBe(true);
  expect(out.complete).toBe(false);
  expect(out.results.queue).toBe('REQUIRES_OPERATOR_LOGS');expect(out.results.webhookReplay).toBe('REQUIRES_OPERATOR_PROVIDER_REDELIVERY');expect(h.calls.filter(p=>p.endsWith('/capture'))).toHaveLength(2);
  expect(h.logs.join('')).not.toContain('ildemo_');
 });
 it('does not equate wallet debit with reservation release',async()=>{
  const h=harness();const base=h.request.getMockImplementation()!;h.options.request=vi.fn(async(url:string)=>{
   const r:any=await base(url);return new URL(url).pathname.endsWith('/payment')?{...r,reservation:{state:'RESERVED'}}:r;
  });expect((await runSandbox(h.options)).diagnostic.code).toBe('RESERVATION_NOT_RELEASED');
 });
});
describe('actual dynamic provider module and safe OAuth helper',()=>{
 it('loads actual provider and transitive zod dependency without a data URL resolver error',async()=>{
  const m=await sourceModule('src/session-payments/providers/paypal.ts');expect(m.formatPayPalMoney(49,'USD')).toBe('49.00');
 });
 it.each([{}, {PAYPAL_ENV:'sandbox'},{...env,PAYPAL_CLIENT_SECRET:' '}])('blocks missing local configuration',async config=>{
  const fetcher=vi.fn();await expect(verifySandboxOAuth(config,fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 });
 it('uses real sandbox endpoint implementation (mock transport only in this test)',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({access_token:'isolated-token'}));
  expect(await verifySandboxOAuth(env,fetcher)).toEqual({oauthVerified:true,merchantVerified:false,paymentVerified:false,environment:'sandbox'});
  expect(fetcher.mock.calls[0][0]).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');expect(fetcher.mock.calls[0][1].body).toBe('grant_type=client_credentials');
 });
 it('reports OAuth transport failure safely',async()=>{
  await expect(verifySandboxOAuth(env,vi.fn().mockRejectedValue(new Error('https://user:secret@db')))).rejects.toThrow('OAUTH_TRANSPORT_FAILURE');
 });
 it.each([401,403])('reports genuine OAuth rejection %i without body',async status=>{
  try{await verifySandboxOAuth(env,vi.fn().mockResolvedValue(Response.json({error_description:'isolated-secret'},{status})));throw 0;}
  catch(e){expect(safeDiagnostic(e,'oauth')).toEqual({stage:'oauth',code:'PAYPAL_OAUTH_REJECTED',status});}
 });
 it('redacts arbitrary exceptions including uppercase secret-shaped messages',()=>{
  for(const text of ['isolated-secret','Bearer isolated-token','ildemo_'+'a'.repeat(64),'SECRET_VALUE','postgres://user:pass@host/db']){
   expect(safeDiagnostic(new Error(text),'capture_request')).toEqual({stage:'capture_request',code:'UNEXPECTED_FAILURE'});
   expect(safePaymentFailure(new Error(text))).toEqual({code:'PAYMENT_OPERATION_FAILED',message:'PAYMENT_OPERATION_FAILED'});
  }
 });
 it('redacts provider error detail but retains HTTP status',()=>{
  expect(safePaymentFailure(new Error('PAYPAL_403:isolated-secret'))).toEqual({code:'PAYPAL_REQUEST_REJECTED',message:'PAYPAL_REQUEST_REJECTED',providerStatus:403});
 });
 it.each([401,403])('readJson retains HTTP %i and allowlisted code only',async status=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'INVALID_CAPABILITY',message:'isolated-secret',token:'isolated-token'},{status})));
  try{await readJson('https://example.invalid');throw 0;}catch(e){expect(safeDiagnostic(e,'demo_capability')).toEqual({stage:'demo_capability',code:'INVALID_CAPABILITY',status});}
 });
});
