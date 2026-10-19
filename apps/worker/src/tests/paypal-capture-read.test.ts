import {describe,it,expect,vi} from "vitest";
import {getPayPalCaptureDetails} from "../session-payments/providers/paypal";

describe("PayPal read-only capture inspection",()=>{
  it("reads capture status without creating or mutating a payment",async()=>{
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({access_token:"token",expires_in:3600}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id:"CAP-1",status:"COMPLETED",amount:{value:"49.00",currency_code:"USD"},
        create_time:"2026-10-18T12:00:00Z",update_time:"2026-10-18T12:01:00Z"
      }),{status:200}));

    const capture=await getPayPalCaptureDetails({
      PAYPAL_ENV:"sandbox",PAYPAL_CLIENT_ID:"client",PAYPAL_CLIENT_SECRET:"secret"
    },"CAP-1",fetcher as any);

    expect(capture).toMatchObject({captureId:"CAP-1",status:"COMPLETED",amount:49,currency:"USD"});
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toContain("/v2/payments/captures/CAP-1");
    expect((fetcher.mock.calls[1][1] as RequestInit).method).toBe("GET");
  });
});
