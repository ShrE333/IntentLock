import {describe,it,expect} from 'vitest';
import {buildProofHash,signProofHash,verifyReceiptIntegrity} from '../session-payments/crypto';
describe('receipt verification independent of audit integrity',()=>{
 const secret='isolated-test-key';
 async function receipt(){const payload={amount:49,audit:{evidenceHeadHash:'head'}};const proofHash=await buildProofHash(payload);return {payload,proofHash,proofSignature:await signProofHash(secret,proofHash)};}
 it('verifies canonical payload and HMAC',async()=>expect(await verifyReceiptIntegrity(await receipt(),secret)).toEqual({payloadHashValid:true,signatureValid:true}));
 it('rejects payload substitution even with the original valid HMAC',async()=>{
   const r=await receipt();r.payload.amount=50;
   expect(await verifyReceiptIntegrity(r,secret)).toEqual({payloadHashValid:false,signatureValid:true});
 });
 it('rejects a substituted hash',async()=>expect(await verifyReceiptIntegrity({...await receipt(),proofHash:'a'.repeat(64)},secret)).toEqual({payloadHashValid:false,signatureValid:false}));
 it('rejects a modified signature and wrong or missing key',async()=>{
   const r=await receipt();expect((await verifyReceiptIntegrity({...r,proofSignature:'0'.repeat(64)},secret)).signatureValid).toBe(false);
   expect((await verifyReceiptIntegrity(r,'wrong')).signatureValid).toBe(false);
   expect((await verifyReceiptIntegrity(r)).signatureValid).toBe(false);
 });
});
