import {describe,it,expect} from "vitest";
import {
  buildSessionPaymentIdempotencyKey,
  buildProofHash,
  signProofHash
} from "../session-payments/crypto";
import {buildSessionReferenceId} from "../session-payments/razorpay";

describe("V11 PurchaseSession payment security",()=>{
  it("builds a deterministic provider-bound payment idempotency key",async()=>{
    const input={
      sessionId:"ps_test",walletId:"iw_test",quoteHash:"a".repeat(64),
      amount:49,currency:"USD",provider:"paypal" as const
    };
    const a=await buildSessionPaymentIdempotencyKey(input);
    const b=await buildSessionPaymentIdempotencyKey(input);
    expect(a).toBe(b);
    expect(a.startsWith("intentlock:session-payment:")).toBe(true);
  });

  it("changes the key when the quote or payment rail changes",async()=>{
    const base={
      sessionId:"ps_test",walletId:"iw_test",quoteHash:"a".repeat(64),
      amount:49,currency:"USD",provider:"paypal" as const
    };
    const original=await buildSessionPaymentIdempotencyKey(base);
    const changedQuote=await buildSessionPaymentIdempotencyKey({...base,quoteHash:"b".repeat(64)});
    const changedRail=await buildSessionPaymentIdempotencyKey({
      ...base,currency:"INR",amount:5899,provider:"razorpay" as const
    });
    expect(original).not.toBe(changedQuote);
    expect(original).not.toBe(changedRail);
  });

  it("preserves deterministic Razorpay reference IDs for the legacy rail",async()=>{
    const key=await buildSessionPaymentIdempotencyKey({
      sessionId:"ps_test",walletId:"iw_test",quoteHash:"a".repeat(64),
      amount:5899,currency:"INR",provider:"razorpay"
    });
    const refA=buildSessionReferenceId(key);
    const refB=buildSessionReferenceId(key);
    expect(refA).toBe(refB);
    expect(refA.startsWith("ilps_")).toBe(true);
    expect(refA.length).toBeLessThanOrEqual(29);
  });

  it("changes proof hash if payment evidence changes",async()=>{
    const base={sessionId:"ps_test",payment:{provider:"paypal",amount:49,captureId:"CAP-1"}};
    const original=await buildProofHash(base);
    const changed=await buildProofHash({
      ...base,payment:{provider:"paypal",amount:50,captureId:"CAP-1"}
    });
    expect(original).not.toBe(changed);
  });

  it("signs the proof hash deterministically with domain separation",async()=>{
    const hash=await buildProofHash({sessionId:"ps_test",amount:49});
    const a=await signProofHash("test-secret",hash);
    const b=await signProofHash("test-secret",hash);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
