import {beforeEach,describe,it,expect,vi} from 'vitest';
import {getVerifiedProofReceipt} from '../session-payments/proof';
import {getProofReceipt} from '../session-payments/repository';
import {getAuditEvents,verifyAuditRows} from '../db/audit';
import {buildProofHash,signProofHash} from '../session-payments/crypto';
vi.mock('../session-payments/repository',()=>({getProofReceipt:vi.fn()}));
vi.mock('../db/client',()=>({getDb:()=>({})}));
vi.mock('../db/audit',async original=>({...await original<typeof import('../db/audit')>(),getAuditEvents:vi.fn(),verifyAuditRows:vi.fn()}));
const secret='isolated-receipt-test-key';let saved:any;
beforeEach(async()=>{
 vi.clearAllMocks();const payload={session:{sessionId:'s'},wallet:{walletId:'w'},audit:{evidenceHeadHash:'head'},amount:49};
 const proofHash=await buildProofHash(payload);saved={receiptId:'pr',sessionId:'s',walletId:'w',payload,proofHash,proofSignature:await signProofHash(secret,proofHash),evidenceAuditHeadHash:'head'};
 vi.mocked(getProofReceipt).mockImplementation(async()=>saved);
 vi.mocked(getAuditEvents).mockResolvedValue([{event_hash:'head'}] as any);
 vi.mocked(verifyAuditRows).mockResolvedValue({valid:true,checkedEvents:1,headHash:'head'});
});
const read=()=>getVerifiedProofReceipt('postgres://test.invalid/db','s',secret);
describe('complete proof verification gates',()=>{
 it('exposes VERIFIED only when all independent checks succeed',async()=>expect((await read())?.verification.verified).toBe(true));
 it.each(['payload','proofHash','proofSignature','evidenceAuditHeadHash','sessionId','walletId'])('rejects tampered %s',async field=>{
   if(field==='payload')saved.payload.amount=50;else saved[field]='tampered';
   expect((await read())?.verification.verified).toBe(false);
 });
 it('rejects a damaged or unrelated audit chain even with valid HMAC',async()=>{
   vi.mocked(verifyAuditRows).mockResolvedValue({valid:false,checkedEvents:0,reason:'HASH_MISMATCH'} as any);
   expect((await read())?.verification.verified).toBe(false);
   vi.mocked(verifyAuditRows).mockResolvedValue({valid:true,checkedEvents:1,headHash:'another'});
   vi.mocked(getAuditEvents).mockResolvedValue([{event_hash:'another'}] as any);
   expect((await read())?.verification.verified).toBe(false);
 });
 it('fails closed without a signing key and never returns it',async()=>{
   const r=await getVerifiedProofReceipt('postgres://test.invalid/db','s');expect(r?.verification.verified).toBe(false);
   expect(JSON.stringify(await read())).not.toContain(secret);
 });
});
