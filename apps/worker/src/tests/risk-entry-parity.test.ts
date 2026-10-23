import {beforeEach,describe,it,expect,vi} from 'vitest';
import {handleSessionRoutes} from '../sessions/routes';
import {handlePurchaseQueue} from '../queue/purchase-jobs';
import {authorizeTransaction} from '../authorize/service';
import {tightenEvaluation} from '../risk/tighten';
import * as sessions from '../sessions/repository';
import * as risk from '../risk/repository';
import * as steps from '../wallets/stepup-repository';
import * as auth from '../authorize/repository';
import {sendWahaText} from '../whatsapp/waha-client';
import {createPaymentLinkForSession} from '../session-payments/service';
import {ACCESS_CONTEXT,whatsappPrincipal} from '../access/identity';
// These parity fixtures now represent server-verified jobs and an explicit API
// wallet grant. Access enforcement itself is exercised in access-control suites.
vi.mock('../access/jobs',()=>({verifyInteractiveJob:vi.fn(async()=>true),finishExecutionJob:vi.fn(),retryExecutionJob:vi.fn()}));
vi.mock('../access/repository',()=>({hasWalletPermission:vi.fn(async(_db,wallet,principal,permission)=>wallet==='w'&&principal==='api:c'&&['read','authorize'].includes(permission))}));
vi.mock('../session-payments/service',async original=>({...await original<typeof import('../session-payments/service')>(),createPaymentLinkForSession:vi.fn()}));
vi.mock('../sessions/repository',()=>({getSession:vi.fn(),claimSessionRun:vi.fn(),updateSession:vi.fn(),addEvent:vi.fn(),addEvents:vi.fn(),getEvents:vi.fn()}));
vi.mock('../wallets/repository',()=>({getWallet:vi.fn(async()=>wallet),recordDecision:vi.fn()}));
vi.mock('../commerce/registry',()=>({getCommerceConnectors:()=>[{info:()=>({id:'test',name:'test'}),search:async()=>[product]}]}));
vi.mock('../risk/repository',()=>({loadAgentRiskContext:vi.fn(),saveRiskAssessment:vi.fn()}));
vi.mock('../wallets/stepup-repository',()=>({createStepUpRequest:vi.fn()}));
vi.mock('../authorize/repository',()=>({findAuthorizationByIdempotency:vi.fn(),createAuthorizationRequest:vi.fn()}));
vi.mock('../whatsapp/waha-client',()=>({sendWahaText:vi.fn()}));
const wallet={walletId:'w',name:'test',currency:'USD',countryCode:'US',totalAuthority:100,spentAmount:0,autoBuyLimit:55,maxSingleTransaction:75,allowedCategories:[],allowedBrands:[],blockedBrands:[],requiredFeatures:[],validUntil:'2099-01-01T00:00:00.000Z',status:'ACTIVE' as const};
const product={id:'p',title:'Sony wireless',brand:'Sony',category:'electronics',merchant:'test',merchantCountry:'US',currency:'USD',price:49,quantityAvailable:1,features:[]};
const env={DATABASE_URL:'postgres://test.invalid/db',WAHA_BASE_URL:'',WAHA_API_KEY:''};
let session:any;
beforeEach(()=>{
 vi.clearAllMocks();session={sessionId:'s',walletId:'w',channel:'WEB',userPrompt:'Sony',connectorId:'test',status:'CREATED',selectedProduct:null,selectedDecision:null,authorizationId:null};
 vi.mocked(sessions.getSession).mockImplementation(async()=>({...session}));
 vi.mocked(sessions.claimSessionRun).mockImplementation(async()=>{session.status='SEARCHING';return {...session};});
 vi.mocked(sessions.updateSession).mockImplementation(async(_db,_id,update)=>{Object.assign(session,update);return {...session};});
 vi.mocked(sessions.getEvents).mockResolvedValue([]);
 vi.mocked(risk.loadAgentRiskContext).mockResolvedValue({capturedCount:0,averageCapturedAmount:0,failedCount30d:5,recentSessions1h:50,recentBlocks30d:10,recentStepUps30d:5,recentQuoteChanges30d:5,recentReplayAttempts30d:5,knownMerchantPurchases:0,previousAssessments:0,averagePreviousTrustScore:null,walletAutoBuyLimit:55,walletHardCeiling:75});
 vi.mocked(risk.saveRiskAssessment).mockImplementation(async(_db,result)=>({...result,assessmentId:'risk',createdAt:new Date().toISOString()}));
 vi.mocked(steps.createStepUpRequest).mockImplementation(async(_db,input)=>({request_id:'step',status:'PENDING',quote_hash:input.quoteHash,requested_amount:input.requestedAmount,current_auto_buy_limit:55,additional_authority_required:input.additionalAuthorityRequired,expires_at:input.expiresAt}));
 vi.mocked(auth.findAuthorizationByIdempotency).mockResolvedValue(null as any);
 vi.mocked(auth.createAuthorizationRequest).mockImplementation(async(_db,input)=>({request_id:'r',decision:input.decision,wallet_id:'w',agent_id:'agent',merchant:'test',quote_hash:input.quoteHash,violations:input.violations,reasons:input.reasons,remaining_authority:input.remainingAuthority,additional_authority_required:input.additionalAuthorityRequired,step_up_request_id:input.stepUpRequestId,created_at:new Date().toISOString()}));
});
describe('risk tightening entry-point parity',()=>{
 it.each(['WEB','API'])('tightens an allowed %s session through the real session route',async channel=>{
   session.channel=channel;const url=new URL('https://worker.test/api/sessions/s/run');
   const response=await handleSessionRoutes(new Request(url,{method:'POST'}),env,url);
   expect(response?.status).toBe(200);expect(session.status).toBe('AWAITING_STEP_UP');expect(session.selectedDecision).toBe('STEP_UP');
   expect(steps.createStepUpRequest).toHaveBeenCalledWith(env.DATABASE_URL,expect.objectContaining({additionalAuthorityRequired:0,requestedAmount:49}));
 });
 it('tightens queued discovery through the same runner without creating payment',async()=>{
   session.channel='WHATSAPP';const message={body:{kind:'RUN_PURCHASE' as const,sessionId:'s',chatId:'chat',wahaSession:'test'},attempts:1,ack:vi.fn(),retry:vi.fn()};
   await handlePurchaseQueue({messages:[message]},env,{});
   expect(session.status).toBe('AWAITING_STEP_UP');expect(message.ack).toHaveBeenCalledOnce();expect(message.retry).not.toHaveBeenCalled();expect(sendWahaText).toHaveBeenCalled();
   expect(createPaymentLinkForSession).not.toHaveBeenCalled();
 });
 it('passes the full environment and actual checkout URL to queued payment delivery',async()=>{
   session.status='READY_TO_PAY';session.selectedProduct=product;
   vi.mocked(createPaymentLinkForSession).mockResolvedValue({paymentLink:{checkoutUrl:'https://sandbox.test/approve'}} as any);
   const configured={...env,PAYPAL_ENV:'sandbox',FX_PROVIDER:'disabled',PAYEELOCK_MODE:'enforce',EBAY_CLIENT_ID:'test-only'};
   const message={body:{kind:'CREATE_PAYMENT' as const,sessionId:'s',chatId:'chat',wahaSession:'test'},attempts:1,ack:vi.fn(),retry:vi.fn()};
   await handlePurchaseQueue({messages:[message]},configured,{});
   expect(createPaymentLinkForSession).toHaveBeenCalledWith({...configured,[ACCESS_CONTEXT]:{kind:'wa',principalId:await whatsappPrincipal('chat'),scopes:['financial:read','payment:execute','session:run']}},'s');
   expect(sendWahaText).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('https://sandbox.test/approve')}));
 });
 it('tightens external authorization API requests with the same risk engine',async()=>{
   const response=await authorizeTransaction({...env,INTENTLOCK_AUTH_SIGNING_SECRET:'test-only'}, {clientId:'c',name:'test',keyPrefix:'test',scopes:['authorize'],status:'ACTIVE'}, {idempotencyKey:'key',agentId:'agent',walletId:'w',merchant:'test',transaction:{amount:49,currency:'USD',quantity:1,brand:'Sony',category:'electronics',features:[]}});
   expect(response.decision).toBe('STEP_UP');expect(response.authorization).toBeNull();expect(response.additionalAuthorityRequired).toBe(0);
 });
 it.each(['OBSERVE','STEP_UP','BLOCK'])('never expands BLOCK under risk action %s',action=>{
   const evaluation={decision:'BLOCK' as const,violations:['BRAND_BLOCKED'],reasons:[],remainingAuthority:100,requestedAmount:49,additionalAuthorityRequired:0,canAutoExecute:false,requiresHumanApproval:false};
   expect(tightenEvaluation(evaluation,action).decision).toBe('BLOCK');
 });
});
