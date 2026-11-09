import {describe,it,expect,vi,beforeEach} from "vitest";

// An over-refund must surface as a readable BLOCK decision. Previously the wallet
// credit calculation's ratio guard threw INVALID_REFUND_RATIO first and hid the reasons.
vi.mock("../sessions/repository",()=>({
  getSession:vi.fn(async()=>({sessionId:"s",walletId:"w",status:"CAPTURED",selectedProduct:{authorizationContext:{presentmentAmount:49,walletAmount:49,walletCurrency:"USD"}}})),
  addEvent:vi.fn()
}));
vi.mock("../session-payments/repository",()=>({
  getSessionPayment:vi.fn(async()=>({sessionId:"s",provider:"paypal",status:"COMPLETED",amount:49,currency:"USD",providerCaptureId:"cap",capturedAt:new Date().toISOString()})),
  getWalletLedgerForSession:vi.fn(async()=>({amount:49,currency:"USD"}))
}));
vi.mock("../post-purchase/repository",()=>({
  listSessionRefunds:vi.fn(async()=>[]),applyWalletRefundOnce:vi.fn(),getRefundById:vi.fn(),getRefundByIdempotencyKey:vi.fn(async()=>null),
  markRefundCompleted:vi.fn(),markRefundFailed:vi.fn(),markRefundProviderAccepted:vi.fn(),reserveRefund:vi.fn()
}));
vi.mock("../session-payments/audit",()=>({appendSessionAuditEvent:vi.fn()}));
vi.mock("../session-payments/providers/paypal",()=>({
  listPayPalDisputes:vi.fn(async()=>[]),createPayPalRefund:vi.fn(),getPayPalRefundDetails:vi.fn(),
  getPayPalDisputeDetails:vi.fn(),sendPayPalDisputeMessage:vi.fn()
}));
import {evaluateSessionRefund,requestSessionRefund} from "../post-purchase/service";
import {createPayPalRefund} from "../session-payments/providers/paypal";

const env={DATABASE_URL:"postgres://x.invalid/db",PAYPAL_ENV:"sandbox"} as any;
beforeEach(()=>vi.clearAllMocks());

describe("refund firewall evaluation",()=>{
  it("reports an over-refund as BLOCK with reasons instead of throwing",async()=>{
    const r=await evaluateSessionRefund(env,"s",{amount:100,currency:"USD",reason:"CUSTOMER_REQUEST"});
    expect(r.policy.decision).toBe("BLOCK");
    expect(r.policy.refundableRemaining).toBe(49);
    expect(r.policy.reasons.join(" ")).toContain("49.00 remains refundable");
    expect(r.walletCredit.amount).toBe(0);
  });
  it("still computes the proportional wallet credit for an allowed partial refund",async()=>{
    const r=await evaluateSessionRefund(env,"s",{amount:10,currency:"USD",reason:"CUSTOMER_REQUEST"});
    expect(r.policy.decision).toBe("ALLOW");
    expect(r.walletCredit).toEqual({amount:10,currency:"USD"});
  });
  it("never calls PayPal for a blocked over-refund request",async()=>{
    await expect(requestSessionRefund(env,"s",{amount:100,currency:"USD",reason:"CUSTOMER_REQUEST"})).rejects.toThrow(/REFUND_POLICY_BLOCKED/);
    expect(createPayPalRefund).not.toHaveBeenCalled();
  });
});
