import {beforeEach,describe,it,expect,vi} from 'vitest';
import {assertChatResource,verifyInteractiveJob} from '../access/jobs';
import {whatsappPrincipal} from '../access/identity';
import * as access from '../access/repository';
import {isWhatsappChatAuthorized} from '../whatsapp/access';
import {handlePurchaseQueue} from '../queue/purchase-jobs';
import {runPurchaseSession} from '../sessions/orchestrator';
import {finalizePayPalCaptureJob} from '../session-payments/service';
const query=vi.hoisted(()=>vi.fn());
vi.mock('@neondatabase/serverless',()=>({neon:()=>Object.assign(vi.fn(async()=>[]),{query})}));
vi.mock('../access/repository',()=>({hasWalletPermission:vi.fn(),resourceWallet:vi.fn()}));
vi.mock('../whatsapp/access',()=>({isWhatsappChatAuthorized:vi.fn()}));
vi.mock('../sessions/orchestrator',()=>({runPurchaseSession:vi.fn()}));
vi.mock('../session-payments/service',()=>({finalizePayPalCaptureJob:vi.fn(),createPaymentLinkForSession:vi.fn()}));
vi.mock('../whatsapp/waha-client',()=>({sendWahaText:vi.fn()}));
const job={jobId:'job',kind:'RUN_PURCHASE' as const,sessionId:'session',chatId:'chat-a',wahaSession:'waha'};
const env={DATABASE_URL:'postgres://isolated.invalid/db',WAHA_BASE_URL:'',WAHA_API_KEY:''};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(isWhatsappChatAuthorized).mockResolvedValue(true);vi.mocked(access.resourceWallet).mockResolvedValue('wallet');vi.mocked(access.hasWalletPermission).mockResolvedValue(true);query.mockResolvedValue([{job_id:'job'}]);});
describe('asynchronous worker execution identity',()=>{
 it('derives chat principals server-side and rechecks session access',async()=>{
   expect(await verifyInteractiveJob(env.DATABASE_URL,job)).toBe(true);
   expect(access.hasWalletPermission).toHaveBeenCalledWith(env.DATABASE_URL,'wallet',await whatsappPrincipal('chat-a'),'execute');
   expect(query.mock.calls[0][1]).toEqual(['job','session',await whatsappPrincipal('chat-a'),'RUN_PURCHASE','chat-a','waha']);
 });
 it('rejects revoked pairings and removed grants',async()=>{
   vi.mocked(isWhatsappChatAuthorized).mockResolvedValue(false);await expect(verifyInteractiveJob(env.DATABASE_URL,job)).rejects.toThrow('CHAT_ACCESS_REVOKED');
   vi.mocked(isWhatsappChatAuthorized).mockResolvedValue(true);vi.mocked(access.hasWalletPermission).mockResolvedValue(false);await expect(verifyInteractiveJob(env.DATABASE_URL,job)).rejects.toThrow('RESOURCE_NOT_FOUND');
   expect(query).not.toHaveBeenCalled();
 });
 it('does not accept a message-supplied owner or an unregistered historical interactive job',async()=>{
   await expect(verifyInteractiveJob(env.DATABASE_URL,{...job,jobId:undefined,principalId:'ops'} as any)).rejects.toThrow('EXECUTION_IDENTITY_REQUIRED');expect(query).not.toHaveBeenCalled();
 });
 it('will not execute an unmatched or already leased job',async()=>{
   query.mockResolvedValue([]);await expect(verifyInteractiveJob(env.DATABASE_URL,job)).rejects.toThrow('EXECUTION_IDENTITY_INVALID_OR_BUSY');
 });
 it('drops untrusted interactive jobs without running discovery or replying to a forged destination',async()=>{
   const message={body:{...job,jobId:undefined},attempts:1,ack:vi.fn(),retry:vi.fn()};await handlePurchaseQueue({messages:[message]},env,{});
   expect(message.ack).toHaveBeenCalledOnce();expect(runPurchaseSession).not.toHaveBeenCalled();
 });
 it('keeps historical verified-webhook settlement independent of visitor capability expiry',async()=>{
   vi.mocked(finalizePayPalCaptureJob).mockResolvedValue({processed:true} as any);
   const message={body:{kind:'FINALIZE_PAYPAL_CAPTURE' as const,payloadHash:'persisted-verified-evidence'},attempts:1,ack:vi.fn(),retry:vi.fn()};
   await handlePurchaseQueue({messages:[message]},env,{});
   expect(finalizePayPalCaptureJob).toHaveBeenCalledWith(env,message.body);expect(isWhatsappChatAuthorized).not.toHaveBeenCalled();expect(message.ack).toHaveBeenCalledOnce();
 });
});
