import {describe,it,expect,vi} from "vitest";
import {createPayPalRefund,getPayPalRefundDetails,listPayPalDisputes,getPayPalDisputeDetails,sendPayPalDisputeMessage} from "../session-payments/providers/paypal";

const env={PAYPAL_ENV:"sandbox",PAYPAL_CLIENT_ID:"id",PAYPAL_CLIENT_SECRET:"secret"};
const tokenResponse=()=>new Response(JSON.stringify({access_token:"token"}),{status:200,headers:{"content-type":"application/json"}});

describe("PayPal post-purchase adapter",()=>{
  it("requests a partial capture refund with idempotency",async()=>{
    const fetcher=vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({id:"R1",status:"COMPLETED",amount:{value:"10.00",currency_code:"USD"}}),{status:201}));
    const r=await createPayPalRefund(env,"CAP1",10,"USD","request-1",fetcher as any);
    expect(r.refundId).toBe("R1");
    const call=fetcher.mock.calls[1];
    expect(String(call[0])).toContain("/v2/payments/captures/CAP1/refund");
    expect((call[1].headers as any)["PayPal-Request-Id"]).toBe("request-1");
  });

  it("reads refund status from PayPal before internal finalization",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      new Response(JSON.stringify({id:"R1",status:"COMPLETED",amount:{value:"10.00",currency_code:"USD"}}),{status:200})
    );
    const r=await getPayPalRefundDetails(env,"R1",fetcher as any);
    expect(r.status).toBe("COMPLETED");
  });

  it("filters PayPal disputes by capture transaction",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      new Response(JSON.stringify({items:[{dispute_id:"D1",status:"WAITING_FOR_SELLER_RESPONSE"}]}),{status:200})
    );
    const r=await listPayPalDisputes(env,"CAP1",fetcher as any);
    expect(r).toHaveLength(1);
    expect(String(fetcher.mock.calls[1][0])).toContain("disputed_transaction_id=CAP1");
  });

  it("retrieves a dispute before deciding what response is allowed",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      new Response(JSON.stringify({dispute_id:"D1",status:"WAITING_FOR_SELLER_RESPONSE"}),{status:200})
    );
    const r:any=await getPayPalDisputeDetails(env,"D1",fetcher as any);
    expect(r.dispute_id).toBe("D1");
  });

  it("can send a bounded dispute message through the official API",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      new Response(JSON.stringify({links:[]}),{status:200})
    );
    await sendPayPalDisputeMessage(env,"D1","IntentLock evidence summary",fetcher as any);
    expect(String(fetcher.mock.calls[1][0])).toContain("/v1/customer/disputes/D1/send-message");
  });
});
