import {describe,it,expect} from "vitest";
import {calculateWalletRefundCredit,evaluateRefundPolicy} from "../post-purchase/policy";

const base={
  sessionStatus:"CAPTURED",paymentStatus:"COMPLETED",provider:"paypal",capturedAt:"2026-10-18T12:00:00.000Z",
  captureAmount:100,captureCurrency:"USD",requestedAmount:25,requestedCurrency:"USD",alreadyReservedAmount:0,
  now:new Date("2026-10-19T12:00:00.000Z"),maxAgeDays:30,openDisputeCount:0,blockOnOpenDispute:true
};

describe("V11.4 Refund Firewall",()=>{
  it("allows a valid partial refund",()=>{
    expect(evaluateRefundPolicy(base).decision).toBe("ALLOW");
  });
  it("blocks refund beyond remaining captured amount",()=>{
    const r=evaluateRefundPolicy({...base,requestedAmount:60,alreadyReservedAmount:50});
    expect(r.decision).toBe("BLOCK");
    expect(r.violations).toContain("REFUND_EXCEEDS_REMAINING_CAPTURE");
  });
  it("blocks currency substitution",()=>{
    const r=evaluateRefundPolicy({...base,requestedCurrency:"EUR"});
    expect(r.violations).toContain("REFUND_CURRENCY_MISMATCH");
  });
  it("blocks non-captured sessions",()=>{
    const r=evaluateRefundPolicy({...base,sessionStatus:"CAPTURE_PENDING"});
    expect(r.violations).toContain("SESSION_NOT_CAPTURED");
  });
  it("blocks when an unresolved dispute already exists",()=>{
    const r=evaluateRefundPolicy({...base,openDisputeCount:1});
    expect(r.violations).toContain("OPEN_DISPUTE_PRESENT");
  });
  it("can observe disputes without blocking when configured",()=>{
    const r=evaluateRefundPolicy({...base,openDisputeCount:1,blockOnOpenDispute:false});
    expect(r.decision).toBe("ALLOW");
  });
  it("blocks requests outside the refund policy window",()=>{
    const r=evaluateRefundPolicy({...base,now:new Date("2026-12-01T12:00:00.000Z")});
    expect(r.violations).toContain("REFUND_WINDOW_EXPIRED");
  });
  it("restores wallet authority using historical FX ratio",()=>{
    expect(calculateWalletRefundCredit({requestedPresentmentAmount:25,originalPresentmentAmount:100,originalWalletDebit:8350})).toBe(2087.5);
  });
  it("rejects an impossible refund ratio",()=>{
    expect(()=>calculateWalletRefundCredit({requestedPresentmentAmount:101,originalPresentmentAmount:100,originalWalletDebit:8350})).toThrow("INVALID_REFUND_RATIO");
  });
});
