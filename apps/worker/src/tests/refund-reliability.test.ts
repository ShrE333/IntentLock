import {describe,it,expect} from "vitest";
import {
  calculateWalletRefundCredit
} from "../post-purchase/policy";
import {
  canRetryReservedRefund,
  classifyPayPalMutationFailure,
  summarizeActiveRefundReservations
} from "../post-purchase/service";

describe("V11.4.1 refund reliability",()=>{
  it("treats network/unknown provider outcomes as uncertain",()=>{
    expect(classifyPayPalMutationFailure(new TypeError("fetch failed"))).toBe("UNCERTAIN");
  });

  it("treats PayPal 5xx and retryable edge statuses as uncertain",()=>{
    expect(classifyPayPalMutationFailure(new Error("PAYPAL_500:internal error"))).toBe("UNCERTAIN");
    expect(classifyPayPalMutationFailure(new Error("PAYPAL_429:rate limited"))).toBe("UNCERTAIN");
    expect(classifyPayPalMutationFailure(new Error("PAYPAL_409:conflict"))).toBe("UNCERTAIN");
  });

  it("treats a stable PayPal client rejection as definitive",()=>{
    expect(classifyPayPalMutationFailure(new Error("PAYPAL_422:UNPROCESSABLE_ENTITY"))).toBe("DEFINITIVE");
  });

  it("retries only an unresolved REQUESTED reservation",()=>{
    expect(canRetryReservedRefund({status:"REQUESTED"} as any)).toBe(true);
    expect(canRetryReservedRefund({status:"PROVIDER_ACCEPTED"} as any)).toBe(false);
    expect(canRetryReservedRefund({status:"COMPLETED"} as any)).toBe(false);
    expect(canRetryReservedRefund({status:"FAILED"} as any)).toBe(false);
  });

  it("closes the final cross-currency partial refund exactly",()=>{
    const first=calculateWalletRefundCredit({
      requestedPresentmentAmount:1,
      originalPresentmentAmount:3,
      originalWalletDebit:250
    });
    const second=calculateWalletRefundCredit({
      requestedPresentmentAmount:1,
      originalPresentmentAmount:3,
      originalWalletDebit:250,
      alreadyReservedPresentmentAmount:1,
      alreadyReservedWalletCreditAmount:first
    });
    const third=calculateWalletRefundCredit({
      requestedPresentmentAmount:1,
      originalPresentmentAmount:3,
      originalWalletDebit:250,
      alreadyReservedPresentmentAmount:2,
      alreadyReservedWalletCreditAmount:first+second
    });

    expect(first).toBe(83.33);
    expect(second).toBe(83.33);
    expect(third).toBe(83.34);
    expect(first+second+third).toBe(250);
  });

  it("excludes an uncertain refund from its own retry reservation totals",()=>{
    const refunds=[
      {refundId:"rf_uncertain",status:"REQUESTED",amount:60,walletCreditAmount:5000},
      {refundId:"rf_done",status:"COMPLETED",amount:20,walletCreditAmount:1670},
      {refundId:"rf_failed",status:"FAILED",amount:15,walletCreditAmount:1252.5}
    ] as any;

    expect(summarizeActiveRefundReservations(refunds)).toEqual({
      presentmentAmount:80,walletCreditAmount:6670
    });
    expect(summarizeActiveRefundReservations(refunds,"rf_uncertain")).toEqual({
      presentmentAmount:20,walletCreditAmount:1670
    });
  });

});
