import {describe,it,expect} from "vitest";
import {activePaymentProvider} from "../session-payments/providers";
import {
  authorizePayPalOrder,
  capturePayPalAuthorization,
  createPayPalOrder,
  extractPayPalWebhookIds,
  formatPayPalMoney,
  isPayPalSupportedCurrency,
  paypalBaseUrl,
  verifyPayPalWebhook
} from "../session-payments/providers/paypal";

const env={
  PAYPAL_ENV:"sandbox",
  PAYPAL_CLIENT_ID:"client",
  PAYPAL_CLIENT_SECRET:"secret",
  PAYPAL_WEBHOOK_ID:"wh_test",
  PAYPAL_RETURN_BASE_URL:"http://localhost:3000"
};

function mockFetch(sequence:Array<{status?:number;body:any}>){
  let i=0;
  return (async (_input:RequestInfo|URL,_init?:RequestInit)=>{
    const next=sequence[i++];
    if(!next) throw new Error("UNEXPECTED_FETCH");
    return new Response(JSON.stringify(next.body),{
      status:next.status??200,
      headers:{"content-type":"application/json"}
    });
  }) as typeof fetch;
}

describe("V11 PayPal primitives",()=>{
  it("uses sandbox by default and live only when requested",()=>{
    expect(paypalBaseUrl({PAYPAL_ENV:"sandbox"})).toContain("sandbox.paypal.com");
    expect(paypalBaseUrl({PAYPAL_ENV:"live"})).toBe("https://api-m.paypal.com");
  });

  it("routes USD to PayPal and INR to Razorpay in auto mode",()=>{
    expect(activePaymentProvider({PAYMENT_PROVIDER:"auto"},"USD")).toBe("paypal");
    expect(activePaymentProvider({PAYMENT_PROVIDER:"auto"},"INR")).toBe("razorpay");
  });

  it("rejects INR rather than pretending PayPal supports it",()=>{
    expect(isPayPalSupportedCurrency("USD")).toBe(true);
    expect(isPayPalSupportedCurrency("INR")).toBe(false);
  });

  it("formats PayPal zero-decimal currencies without fake fractional units",()=>{
    expect(formatPayPalMoney(5000,"JPY")).toBe("5000");
    expect(()=>formatPayPalMoney(5000.5,"JPY")).toThrow(/ZERO_DECIMAL/);
    expect(formatPayPalMoney(49,"USD")).toBe("49.00");
  });

  it("creates an AUTHORIZE order and returns the buyer approval URL",async()=>{
    const fetcher=mockFetch([
      {body:{access_token:"token"}},
      {status:201,body:{
        id:"ORDER-1",status:"CREATED",
        links:[{rel:"approve",href:"https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1"}]
      }}
    ]);

    const checkout=await createPayPalOrder(env,{
      sessionId:"ps_1",walletId:"iw_1",authorizationId:null,
      quoteHash:"a".repeat(64),productId:"sony_49",
      productTitle:"Sony Wireless ANC Headphones",merchant:"IntentLock Demo",
      merchantCountry:"US",buyerCountry:"IN",walletAmount:4091.5,walletCurrency:"INR",
      amount:49,currency:"USD",idempotencyKey:"idem-1",
      expiresAt:"2099-01-01T00:00:00.000Z"
    },fetcher);

    expect(checkout.provider).toBe("paypal");
    expect(checkout.providerOrderId).toBe("ORDER-1");
    expect(checkout.checkoutUrl).toContain("sandbox.paypal.com");
  });

  it("authorizes the approved order before capture",async()=>{
    const fetcher=mockFetch([
      {body:{access_token:"token"}},
      {status:201,body:{
        status:"COMPLETED",
        purchase_units:[{payments:{authorizations:[{
          id:"AUTH-1",status:"CREATED",amount:{value:"49.00",currency_code:"USD"}
        }]}}]
      }}
    ]);

    const auth=await authorizePayPalOrder(env,"ORDER-1","idem-auth",fetcher);
    expect(auth.providerAuthorizationId).toBe("AUTH-1");
    expect(auth.amount).toBe(49);
    expect(auth.currency).toBe("USD");
  });

  it("captures an authorization using Payments v2",async()=>{
    const fetcher=mockFetch([
      {body:{access_token:"token"}},
      {status:201,body:{
        id:"CAP-1",status:"COMPLETED",amount:{value:"49.00",currency_code:"USD"}
      }}
    ]);

    const capture=await capturePayPalAuthorization(
      env,"AUTH-1","ORDER-1","idem-capture",fetcher
    );
    expect(capture.providerCaptureId).toBe("CAP-1");
    expect(capture.status).toBe("COMPLETED");
  });

  it("trusts a webhook only after PayPal verification returns SUCCESS",async()=>{
    const fetcher=mockFetch([
      {body:{access_token:"token"}},
      {body:{verification_status:"SUCCESS"}}
    ]);
    const event={
      id:"WH-1",event_type:"PAYMENT.CAPTURE.COMPLETED",
      resource:{
        id:"CAP-1",amount:{value:"49.00",currency_code:"USD"},
        supplementary_data:{related_ids:{order_id:"ORDER-1",authorization_id:"AUTH-1"}}
      }
    };
    const request=new Request("https://worker.test/webhooks/paypal",{
      method:"POST",
      headers:{
        "paypal-transmission-id":"tx-1",
        "paypal-transmission-time":"2026-10-07T00:00:00Z",
        "paypal-cert-url":"https://api-m.sandbox.paypal.com/cert",
        "paypal-auth-algo":"SHA256withRSA",
        "paypal-transmission-sig":"sig"
      },
      body:JSON.stringify(event)
    });

    const verified=await verifyPayPalWebhook(env,request,JSON.stringify(event),fetcher);
    expect(verified.valid).toBe(true);

    const ids=extractPayPalWebhookIds(event);
    expect(ids.captureId).toBe("CAP-1");
    expect(ids.orderId).toBe("ORDER-1");
    expect(ids.amount).toBe(49);
  });
});
