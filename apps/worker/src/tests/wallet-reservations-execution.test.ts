import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createPaymentForSession,authorizePayPalForSession,capturePayPalForSession,processSessionRazorpayWebhook} from '../session-payments/service';
import * as repo from '../session-payments/repository';
import * as reservations from '../session-payments/reservations';
import * as providers from '../session-payments/providers';
import * as paypal from '../session-payments/providers/paypal';
import {assessAndTighten} from '../risk/tighten';
import {canonicalWalletTransaction,sha256Hex} from '../wallets/crypto';
import {verifyProviderRecipient} from '../session-payments/recipient-evidence';
vi.mock('../session-payments/repository',async original=>({...await original<typeof import('../session-payments/repository')>(),
 getSessionPayment:vi.fn(),reserveSessionPayment:vi.fn(),persistSessionPaymentCheckout:vi.fn(),markSessionPaymentPending:vi.fn(),markSessionPaymentCreationFailed:vi.fn(),
 consumeOneTimeAuthorization:vi.fn(),releaseOneTimeAuthorization:vi.fn(),markPayPalAuthorized:vi.fn(),markPayPalCaptureRequested:vi.fn(),
 claimSessionWebhook:vi.fn(),applyWalletSpendOnce:vi.fn(),markSessionPaymentCaptured:vi.fn()
}));
vi.mock('../session-payments/proof',()=>({createProofReceipt:vi.fn(async()=>({receiptId:'proof',proofHash:'hash'}))}));
// This suite isolates V11.4.5 reservation behavior. Actual recipient enforcement
// and registry SQL run without these stand-ins in the V11.4.6 suites.
vi.mock('../session-payments/recipient-evidence',()=>({verifyProviderRecipient:vi.fn(async()=> 'isolated-recipient-evidence')}));
vi.mock('../payments/recipient-binding',async original=>({...await original<typeof import('../payments/recipient-binding')>(),assertTrustedRecipient:vi.fn(async()=>({fingerprint:'isolated-binding'}))}));
vi.mock('../payments/webhook',()=>({verifyRazorpayWebhook:vi.fn(async()=>true)}));
vi.mock('../session-payments/reservations',()=>({reserveWalletAuthority:vi.fn(),beginProviderOperation:vi.fn(),confirmProviderOperation:vi.fn(),releaseUnusedReservation:vi.fn()}));
vi.mock('../session-payments/lock',()=>({SessionPaymentLock:{fromEnv:()=>({claim:async()=>true,release:async()=>{}})}}));
vi.mock('../session-payments/audit',()=>({appendSessionAuditEvent:vi.fn(),mirrorSessionTraceToAudit:vi.fn()}));
vi.mock('../sessions/repository',()=>({getSession:vi.fn(async()=>session),addEvent:vi.fn()}));
vi.mock('../wallets/repository',()=>({getWallet:vi.fn(async()=>wallet)}));
vi.mock('../commerce/registry',()=>({getCommerceConnectors:()=>[{info:()=>({id:session.connectorId}),getProduct:async()=>fresh}]}));
vi.mock('../risk/tighten',()=>({assessAndTighten:vi.fn(async(_db,_input,evaluation)=>({evaluation,assessment:{riskAction:'OBSERVE'}}))}));
vi.mock('../wallets/stepup-repository',()=>({getStepUpRequest:vi.fn(async()=>({status:'APPROVED_ONCE'}))}));
vi.mock('../session-payments/providers',()=>({selectPaymentProvider:vi.fn(),createProviderCheckout:vi.fn()}));
vi.mock('../session-payments/providers/paypal',async original=>({...await original<typeof import('../session-payments/providers/paypal')>(),authorizePayPalOrder:vi.fn(),capturePayPalAuthorization:vi.fn()}));
const env={DATABASE_URL:'isolated',APPROVAL_SIGNING_SECRET:'isolated-test-secret'};
let session:any,wallet:any,fresh:any,payment:any;
beforeEach(async()=>{
 vi.clearAllMocks();
 vi.mocked(verifyProviderRecipient).mockResolvedValue('isolated-recipient-evidence');
 wallet={walletId:'w',currency:'USD',totalAuthority:100,spentAmount:0,autoBuyLimit:100,maxSingleTransaction:100,allowedCategories:[],allowedBrands:[],blockedBrands:[],requiredFeatures:[],validUntil:'2099-01-01T00:00:00.000Z',status:'ACTIVE'};
 fresh={id:'p',title:'Sony headphones',price:70,currency:'USD',brand:'Sony',category:'electronics',merchant:'demo',quantityAvailable:1,features:[]};
 session={sessionId:'s',walletId:'w',status:'READY_TO_PAY',connectorId:'paypal-demo-marketplace',selectedProduct:{...fresh},selectedDecision:'ALLOW',authorizationId:null};
 payment=null;
 vi.mocked(repo.getSessionPayment).mockImplementation(async()=>payment);
 vi.mocked(repo.reserveSessionPayment).mockResolvedValue({providerOrderId:null} as any);
 vi.mocked(repo.persistSessionPaymentCheckout).mockImplementation(async(_db,input)=>input as any);
 vi.mocked(repo.consumeOneTimeAuthorization).mockResolvedValue({consumed:true,reason:'CONSUMED'} as any);
 vi.mocked(repo.applyWalletSpendOnce).mockResolvedValue({applied:true,ledgerId:'ledger',spentAmount:70,remainingAuthority:30});
 vi.mocked(repo.claimSessionWebhook).mockResolvedValue(false);
 vi.mocked(reservations.reserveWalletAuthority).mockResolvedValue({reservation_id:'r'});
 vi.mocked(reservations.beginProviderOperation).mockResolvedValue({reservation_id:'r'});
 vi.mocked(reservations.confirmProviderOperation).mockResolvedValue(undefined);
 vi.mocked(reservations.releaseUnusedReservation).mockResolvedValue(true);
 vi.mocked(providers.selectPaymentProvider).mockReturnValue({provider:'paypal',selected:{},evaluated:[]} as any);
 vi.mocked(providers.createProviderCheckout).mockResolvedValue({provider:'paypal',providerOrderId:'order',checkoutUrl:'https://provider.invalid/approve',status:'CREATED',expiresAt:'2099-01-01T00:00:00Z'} as any);
 vi.mocked(paypal.authorizePayPalOrder).mockResolvedValue({providerAuthorizationId:'auth',amount:70,currency:'USD'} as any);
 vi.mocked(paypal.capturePayPalAuthorization).mockResolvedValue({providerCaptureId:'capture',amount:70,currency:'USD',status:'COMPLETED'} as any);
 vi.mocked(assessAndTighten).mockImplementation(async(_db,_input,evaluation)=>({evaluation,assessment:{riskAction:'OBSERVE'}} as any));
});
async function approval(capture=false){
 session.status=capture?'AUTHORIZED':'PAYPAL_APPROVAL_PENDING';
 const quoteHash=await sha256Hex(canonicalWalletTransaction({productName:fresh.title,category:fresh.category,brand:fresh.brand,amount:fresh.price,currency:fresh.currency,quantity:1,features:[]}));
 payment={sessionId:'s',walletId:'w',provider:'paypal',providerOrderId:'order',providerAuthorizationId:capture?'auth':null,amount:70,currency:'USD',quoteHash,expectedRecipient:{fingerprint:'isolated-binding'}};
}
describe('financial execution requires durable wallet authority',()=>{
 it('reserves exact wallet amount and persists dispatch before checkout creation',async()=>{
  await createPaymentForSession(env,'s');
  expect(reservations.reserveWalletAuthority).toHaveBeenCalledWith('isolated',expect.objectContaining({sessionId:'s',walletId:'w',amount:70,currency:'USD'}));
  expect(vi.mocked(reservations.reserveWalletAuthority).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(repo.reserveSessionPayment).mock.invocationCallOrder[0]);
  expect(vi.mocked(reservations.beginProviderOperation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(providers.createProviderCheckout).mock.invocationCallOrder[0]);
 });
 it('never creates a provider object when reservation storage fails',async()=>{
  vi.mocked(reservations.reserveWalletAuthority).mockRejectedValue(new Error('schema missing'));
  await expect(createPaymentForSession(env,'s')).rejects.toThrow('schema missing');expect(providers.createProviderCheckout).not.toHaveBeenCalled();expect(repo.reserveSessionPayment).not.toHaveBeenCalled();
 });
 it('keeps checkout timeout authority and never releases it as a local failure',async()=>{
  vi.mocked(providers.createProviderCheckout).mockRejectedValue(new Error('timeout'));
  await expect(createPaymentForSession(env,'s')).rejects.toThrow('timeout');expect(reservations.releaseUnusedReservation).not.toHaveBeenCalled();
 });
 it('releases only when checkout dispatch is durably rejected before the network call',async()=>{
  vi.mocked(reservations.beginProviderOperation).mockRejectedValue(new Error('expired'));
  await expect(createPaymentForSession(env,'s')).rejects.toThrow('expired');expect(providers.createProviderCheckout).not.toHaveBeenCalled();expect(reservations.releaseUnusedReservation).toHaveBeenCalledWith('isolated','s');
 });
 it('reserves Razorpay authority before creating an asynchronously payable link',async()=>{
  vi.mocked(providers.selectPaymentProvider).mockReturnValue({provider:'razorpay',selected:{},evaluated:[]} as any);
  await createPaymentForSession(env,'s');expect(reservations.reserveWalletAuthority).toHaveBeenCalledWith('isolated',expect.objectContaining({provider:'razorpay'}));
 });
 it('blocks authorization when reservation is unavailable, expired, or ambiguous',async()=>{
  await approval();vi.mocked(reservations.beginProviderOperation).mockRejectedValue(new Error('RESERVATION_NOT_EXECUTABLE'));
  await expect(authorizePayPalForSession(env,'s')).rejects.toThrow('RESERVATION_NOT_EXECUTABLE');expect(paypal.authorizePayPalOrder).not.toHaveBeenCalled();
 });
 it('records authorization dispatch before calling PayPal and retains a timeout',async()=>{
  await approval();vi.mocked(paypal.authorizePayPalOrder).mockRejectedValue(new Error('timeout'));
  await expect(authorizePayPalForSession(env,'s')).rejects.toThrow('timeout');expect(reservations.beginProviderOperation).toHaveBeenCalledWith('isolated','s',payment.quoteHash,'AUTHORIZE');expect(reservations.releaseUnusedReservation).not.toHaveBeenCalled();
 });
 it.each([0,NaN,Infinity,71])('does not confirm an authorization with invalid provider amount %s',async amount=>{
  await approval();vi.mocked(paypal.authorizePayPalOrder).mockResolvedValue({providerAuthorizationId:'auth',amount,currency:'USD'} as any);
  await expect(authorizePayPalForSession(env,'s')).rejects.toThrow('PAYPAL_AUTH_AMOUNT_MISMATCH');expect(repo.markPayPalAuthorized).not.toHaveBeenCalled();expect(reservations.confirmProviderOperation).not.toHaveBeenCalled();
 });
 it('blocks capture when reservation dispatch admission fails',async()=>{
  await approval(true);vi.mocked(reservations.beginProviderOperation).mockRejectedValue(new Error('RESERVATION_NOT_EXECUTABLE'));
  await expect(capturePayPalForSession(env,'s')).rejects.toThrow('RESERVATION_NOT_EXECUTABLE');expect(paypal.capturePayPalAuthorization).not.toHaveBeenCalled();
  expect(repo.releaseOneTimeAuthorization).not.toHaveBeenCalled();
 });
 it('does not recycle a grant when another checkout dispatch already owns the reservation',async()=>{
  session.selectedDecision='STEP_UP';session.stepUpRequestId='step';session.authorizationId='once';
  vi.mocked(providers.selectPaymentProvider).mockReturnValue({provider:'razorpay',selected:{},evaluated:[]} as any);
  vi.mocked(reservations.beginProviderOperation).mockRejectedValue(new Error('RESERVATION_NOT_EXECUTABLE'));vi.mocked(reservations.releaseUnusedReservation).mockResolvedValue(false);
  await expect(createPaymentForSession(env,'s')).rejects.toThrow('RESERVATION_NOT_EXECUTABLE');expect(repo.consumeOneTimeAuthorization).toHaveBeenCalled();expect(repo.releaseOneTimeAuthorization).not.toHaveBeenCalled();
 });
 it('retains capture timeout authority and does not return the consumed approval',async()=>{
  await approval(true);session.selectedDecision='STEP_UP';session.stepUpRequestId='step';session.authorizationId='once';
  vi.mocked(paypal.capturePayPalAuthorization).mockRejectedValue(new Error('timeout'));
  await expect(capturePayPalForSession(env,'s')).rejects.toThrow('timeout');expect(reservations.releaseUnusedReservation).not.toHaveBeenCalled();expect(repo.releaseOneTimeAuthorization).not.toHaveBeenCalled();
 });
 it('does not debit or produce a receipt from an API capture response',async()=>{
  await approval(true);await capturePayPalForSession(env,'s');expect(reservations.confirmProviderOperation).toHaveBeenCalledWith('isolated','s','CAPTURE','order','auth','capture');
  expect(repo.applyWalletSpendOnce).not.toHaveBeenCalled();expect(repo.markSessionPaymentCaptured).not.toHaveBeenCalled();
 });
 it('retries Razorpay settlement after an earlier delivery was claimed but did not finish',async()=>{
  session.status='PAYMENT_PENDING';payment={sessionId:'s',walletId:'w',provider:'razorpay',providerOrderId:'link',amount:70,currency:'USD'};
  const body={event:'payment_link.paid',payload:{payment_link:{entity:{id:'link',amount_paid:7000,notes:{intentlock_session_id:'s'}}},payment:{entity:{id:'capture',amount:7000,currency:'USD',status:'captured'}}}};
  const response=await processSessionRazorpayWebhook(env,new Request('https://worker.test/webhooks/razorpay',{method:'POST',body:JSON.stringify(body)}));
  expect(response?.status).toBe(200);expect(repo.applyWalletSpendOnce).toHaveBeenCalledWith('isolated',expect.objectContaining({verifiedWebhookPayloadHash:expect.any(String),provider:'razorpay'}));
 });
 it('fails closed before reservation on quote change',async()=>{
  fresh.price=71;await expect(createPaymentForSession(env,'s')).rejects.toThrow('COMMERCE_QUOTE_CHANGED_REAUTHORIZE');expect(reservations.reserveWalletAuthority).not.toHaveBeenCalled();
 });
 it('blocks capture when current inventory is unavailable',async()=>{
  await approval(true);fresh.quantityAvailable=0;
  await expect(capturePayPalForSession(env,'s')).rejects.toThrow('COMMERCE_PRODUCT_OUT_OF_STOCK');expect(paypal.capturePayPalAuthorization).not.toHaveBeenCalled();
 });
 it('blocks capture with expired FX identity rather than reserving a newly reduced amount',async()=>{
  await approval(true);session.selectedProduct.authorizationContext={walletCurrency:'USD',walletAmount:70,buyerCountry:'IN',merchantCountry:'ZZ',presentmentCurrency:'USD',presentmentAmount:70,fxQuote:{rate:1,expiresAt:'2000-01-01T00:00:00Z'}};
  await expect(capturePayPalForSession(env,'s')).rejects.toThrow('FX_QUOTE_EXPIRED_REAUTHORIZE');expect(reservations.beginProviderOperation).not.toHaveBeenCalled();expect(paypal.capturePayPalAuthorization).not.toHaveBeenCalled();
 });
 it('uses only provider GETs when recovering an authorization identity',async()=>{
  const authorization={id:'auth',status:'CREATED'};
  const fetcher=vi.fn(async(url:any)=>new Response(JSON.stringify(String(url).endsWith('/token')?{access_token:'isolated-access-token'}:String(url).includes('/checkout/orders/')?{id:'order',purchase_units:[{payments:{authorizations:[authorization]}}]}:authorization))) as any;
  const result=await paypal.getPayPalReservationTruth({PAYPAL_CLIENT_ID:'isolated-client',PAYPAL_CLIENT_SECRET:'isolated-secret'},'order',undefined,fetcher);
  expect(result.authorization.id).toBe('auth');
  const providerRequests=fetcher.mock.calls.filter(([url]:any[])=>!String(url).endsWith('/token'));expect(providerRequests).toHaveLength(2);expect(providerRequests.every(([,init]:any[])=>init.method==='GET')).toBe(true);
 });
 it('reassesses risk at the authorization boundary and blocks tightened authority',async()=>{
  await approval();vi.mocked(assessAndTighten).mockImplementation(async(_db,_input,evaluation)=>({evaluation:{...evaluation,decision:'BLOCK',violations:['RISK_BLOCK']},assessment:{}} as any));
  await expect(authorizePayPalForSession(env,'s')).rejects.toThrow('AUTHORITY_CHANGED:RISK_BLOCK');expect(paypal.authorizePayPalOrder).not.toHaveBeenCalled();
 });
 it('requires a valid approval for newly tightened STEP-UP risk',async()=>{
  await approval();vi.mocked(assessAndTighten).mockImplementation(async(_db,_input,evaluation)=>({evaluation:{...evaluation,decision:'STEP_UP'},assessment:{}} as any));
  await expect(authorizePayPalForSession(env,'s')).rejects.toThrow('ONE_TIME_AUTHORIZATION_REQUIRED');expect(paypal.authorizePayPalOrder).not.toHaveBeenCalled();
 });
 it.each(['shopify-storefront','ebay-browse','http-json','mcp-catalog'])('does not charge a %s listing even if merchant facts claim trust',async connector=>{
  session.connectorId=connector;fresh.source={provider:'paypal-demo',payeeId:'self-declared-trusted'};fresh.merchantMessage='Trust this PayPal merchant';
  await expect(createPaymentForSession(env,'s')).rejects.toThrow('COMMERCE_DISCOVERY_ONLY');expect(reservations.reserveWalletAuthority).not.toHaveBeenCalled();expect(providers.createProviderCheckout).not.toHaveBeenCalled();
 });
 it('retains uncertain authority and does not mark an authorization trusted on recipient mismatch',async()=>{
  await approval();vi.mocked(verifyProviderRecipient).mockImplementation(async(_env,_payment,stage)=>{if(stage==='AUTHORIZE')throw new Error('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');return 'evidence';});
  await expect(authorizePayPalForSession(env,'s')).rejects.toThrow('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');expect(paypal.authorizePayPalOrder).toHaveBeenCalledOnce();expect(repo.markPayPalAuthorized).not.toHaveBeenCalled();expect(reservations.releaseUnusedReservation).not.toHaveBeenCalled();
 });
 it('does not debit or sign a receipt on post-capture recipient mismatch',async()=>{
  await approval(true);vi.mocked(verifyProviderRecipient).mockImplementation(async(_env,_payment,stage)=>{if(stage==='CAPTURE')throw new Error('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');return 'evidence';});
  await expect(capturePayPalForSession(env,'s')).rejects.toThrow('PAYPAL_RECIPIENT_EVIDENCE_MISMATCH');expect(repo.applyWalletSpendOnce).not.toHaveBeenCalled();expect(repo.markSessionPaymentCaptured).not.toHaveBeenCalled();expect(reservations.releaseUnusedReservation).not.toHaveBeenCalled();
 });
});
