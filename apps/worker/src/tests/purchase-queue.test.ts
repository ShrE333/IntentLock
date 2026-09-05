import {describe,it,expect} from "vitest";
import {
  isNonRetryable
} from "../queue/purchase-jobs";

describe("V10.8.5 async purchase queue",()=>{
  it("does not retry deterministic authority failures",()=>{
    expect(
      isNonRetryable(
        new Error("COMMERCE_QUOTE_CHANGED_REAUTHORIZE")
      )
    ).toBe(true);

    expect(
      isNonRetryable(
        new Error("WALLET_EXPIRED")
      )
    ).toBe(true);
  });

  it("retries transient infrastructure failures",()=>{
    expect(
      isNonRetryable(
        new Error("Neon connection temporarily unavailable")
      )
    ).toBe(false);

    expect(
      isNonRetryable(
        new Error("RAZORPAY_503: upstream unavailable")
      )
    ).toBe(false);
  });
});
