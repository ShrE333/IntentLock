import { describe, expect, it } from 'vitest';
import { buildReferenceId, rupeesToPaise } from '../payments/razorpay';
import { verifyRazorpayWebhook } from '../payments/webhook';

async function sign(body:string, secret:string){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(body)));
  return Array.from(sig).map(b=>b.toString(16).padStart(2,'0')).join('');
}

describe('Razorpay primitives',()=>{
  it('converts rupees to paise',()=>expect(rupeesToPaise(5899)).toBe(589900));
  it('builds deterministic reference id',()=>expect(buildReferenceId('intentlock:checkout:1234567890abcdef1234567890abcdef')).toBe('il_1234567890abcdef12345678'));
  it('accepts valid webhook signature',async()=>{ const b='{"event":"payment_link.paid"}',s='test-secret'; expect(await verifyRazorpayWebhook(b,await sign(b,s),s)).toBe(true); });
  it('rejects changed webhook body',async()=>{ const b='{"event":"payment_link.paid"}',s='test-secret'; expect(await verifyRazorpayWebhook(b+' ',await sign(b,s),s)).toBe(false); });
});
