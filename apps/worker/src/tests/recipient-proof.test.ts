import {beforeEach,describe,it,expect,vi} from 'vitest';
import {getVerifiedProofReceipt} from '../session-payments/proof';
import {getProofReceipt} from '../session-payments/repository';
import {getAuditEvents,verifyAuditRows} from '../db/audit';
import {getRecipientSettlement} from '../session-payments/recipient-evidence';
import {buildProofHash,signProofHash} from '../session-payments/crypto';
import {syntheticBinding,syntheticMerchant,otherSyntheticMerchant} from './recipient-fixtures';
vi.mock('../session-payments/repository',()=>({getProofReceipt:vi.fn()}));
vi.mock('../session-payments/recipient-evidence',()=>({getRecipientSettlement:vi.fn()}));
vi.mock('../db/client',()=>({getDb:()=>({})}));
vi.mock('../db/audit',async original=>({...await original<typeof import('../db/audit')>(),getAuditEvents:vi.fn(),verifyAuditRows:vi.fn()}));
const secret='isolated-proof-test-secret';let receipt:any,evidence:any;
async function signed(payload:any){const proofHash=await buildProofHash(payload);return {receiptId:'proof',sessionId:'s',walletId:'w',payload,proofHash,proofSignature:await signProofHash(secret,proofHash),evidenceAuditHeadHash:'head'};}
beforeEach(async()=>{
 vi.resetAllMocks();const binding=await syntheticBinding();
 receipt=await signed({version:'intentlock-proof-v1.4',session:{sessionId:'s'},wallet:{walletId:'w'},audit:{evidenceHeadHash:'head'},payment:{provider:'paypal',providerOrderId:'order',providerAuthorizationId:'auth',providerCaptureId:'capture'},recipientVerification:{status:'VERIFIED',expected:binding,actualMerchantId:syntheticMerchant,evidenceId:'evidence',environment:'sandbox'}});
 evidence={observation_id:'evidence',expected_fingerprint:binding.fingerprint,expected_recipient:structuredClone(binding),wallet_id:'w',order_id:'order',authorization_id:'auth',capture_id:'capture',actual_merchant_id:syntheticMerchant,environment:'sandbox'};
 vi.mocked(getProofReceipt).mockImplementation(async()=>receipt);vi.mocked(getRecipientSettlement).mockImplementation(async()=>evidence);
 vi.mocked(getAuditEvents).mockResolvedValue([{event_hash:'head'}] as any);vi.mocked(verifyAuditRows).mockResolvedValue({valid:true,checkedEvents:1,headHash:'head'});
});
const read=()=>getVerifiedProofReceipt('isolated','s',secret);
describe('recipient assurance is independent of signed receipt integrity',()=>{
 it('verifies only a valid HMAC/audit receipt with matching SQL-verified recipient evidence',async()=>{
  expect((await read())?.verification).toMatchObject({verified:true,recipientVerified:true,integrityVerified:true});
 });
 it('does not label a historical PayPal capture recipient verified or rewrite its signed payload',async()=>{
  const payload={version:'intentlock-proof-v1.3',session:{sessionId:'s'},wallet:{walletId:'w'},audit:{evidenceHeadHash:'head'},payment:{provider:'paypal'}};
  receipt=await signed(payload);const original=JSON.stringify(receipt);
  expect((await read())?.verification).toMatchObject({verified:false,recipientVerified:false,integrityVerified:true,recipientStatus:'LEGACY_OR_UNVERIFIED'});expect(JSON.stringify(receipt)).toBe(original);expect(getRecipientSettlement).not.toHaveBeenCalled();
 });
 it('refuses VERIFIED when provider evidence is unavailable despite valid HMAC',async()=>{
  evidence=null;expect((await read())?.verification).toMatchObject({verified:false,integrityVerified:true});
 });
 it.each(['actual_merchant_id','expected_fingerprint','observation_id','environment'])('rejects a mismatched %s in independent evidence',async field=>{
  evidence[field]='different';expect((await read())?.verification.verified).toBe(false);
 });
 it('does not accept a signed but contradictory expected recipient',async()=>{
  receipt.payload.recipientVerification.expected.paypalMerchantId=otherSyntheticMerchant;receipt=await signed(receipt.payload);expect((await read())?.verification).toMatchObject({integrityVerified:true,verified:false});
 });
 it('still rejects tampered recipient payloads with their original signature',async()=>{
  receipt.payload.recipientVerification.actualMerchantId=otherSyntheticMerchant;expect((await read())?.verification).toMatchObject({payloadHashValid:false,verified:false});
 });
 it('requires the complete independently persisted merchant mapping, not a copied fingerprint',async()=>{
  receipt.payload.recipientVerification.expected.merchantOfRecordId='different-entity';receipt=await signed(receipt.payload);expect((await read())?.verification).toMatchObject({integrityVerified:true,verified:false});
 });
});
