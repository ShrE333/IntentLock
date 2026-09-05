import {describe,it,expect} from "vitest";
import {
  buildSessionPaymentIdempotencyKey,
  buildProofHash,
  signProofHash
} from "../session-payments/crypto";
import {buildSessionReferenceId} from "../session-payments/razorpay";

describe("V10.6 PurchaseSession payment security",()=>{
  it("builds a deterministic payment idempotency key",async()=>{
    const input={
      sessionId:"ps_test",
      walletId:"iw_test",
      quoteHash:"a".repeat(64),
      amount:5899,
      currency:"INR"
    };

    const a=await buildSessionPaymentIdempotencyKey(input);
    const b=await buildSessionPaymentIdempotencyKey(input);

    expect(a).toBe(b);
    expect(a.startsWith("intentlock:session-payment:")).toBe(true);
  });

  it("changes the idempotency key if the exact quote changes",async()=>{
    const base={
      sessionId:"ps_test",
      walletId:"iw_test",
      quoteHash:"a".repeat(64),
      amount:5899,
      currency:"INR"
    };

    const original=await buildSessionPaymentIdempotencyKey(base);
    const changed=await buildSessionPaymentIdempotencyKey({
      ...base,
      quoteHash:"b".repeat(64)
    });

    expect(original).not.toBe(changed);
  });

  it("creates a short deterministic Razorpay reference id",async()=>{
    const key=await buildSessionPaymentIdempotencyKey({
      sessionId:"ps_test",
      walletId:"iw_test",
      quoteHash:"a".repeat(64),
      amount:5899,
      currency:"INR"
    });

    const refA=buildSessionReferenceId(key);
    const refB=buildSessionReferenceId(key);

    expect(refA).toBe(refB);
    expect(refA.startsWith("ilps_")).toBe(true);
    expect(refA.length).toBeLessThanOrEqual(29);
  });

  it("proof hash changes when payment evidence changes",async()=>{
    const base={
      sessionId:"ps_test",
      payment:{amount:5899,paymentId:"pay_1"},
      wallet:{remainingAuthority:4101}
    };

    const original=await buildProofHash(base);
    const changed=await buildProofHash({
      ...base,
      payment:{amount:5900,paymentId:"pay_1"}
    });

    expect(original).not.toBe(changed);
  });

  it("signs the proof hash deterministically with domain separation",async()=>{
    const hash=await buildProofHash({sessionId:"ps_test",amount:5899});
    const a=await signProofHash("test-secret",hash);
    const b=await signProofHash("test-secret",hash);

    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
