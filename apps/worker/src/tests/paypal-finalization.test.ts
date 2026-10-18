import {beforeEach,describe,expect,it,vi} from "vitest";
import {handlePurchaseQueue} from "../queue/purchase-jobs";
import * as repo from "../session-payments/repository";
import * as sessions from "../sessions/repository";
import * as audit from "../session-payments/audit";
import * as proof from "../session-payments/proof";
import * as paypal from "../session-payments/providers/paypal";
import {finalizePayPalCaptureJob,processSessionPayPalWebhook,type SessionPaymentEnv} from "../session-payments/service";

vi.mock("../session-payments/repository",async importOriginal=>({
  ...await importOriginal<typeof import("../session-payments/repository")>(),
  getSessionPayment:vi.fn(),getSessionPaymentByCaptureId:vi.fn(),getSessionPaymentByProviderOrderId:vi.fn(),
  getProofReceipt:vi.fn(),getVerifiedPayPalWebhook:vi.fn(),claimSessionWebhook:vi.fn(),
  applyWalletSpendOnce:vi.fn(),markSessionPaymentCaptured:vi.fn(),markSessionPaymentFailed:vi.fn()
}));
vi.mock("../sessions/repository",async importOriginal=>({
  ...await importOriginal<typeof import("../sessions/repository")>(),getSession:vi.fn(),addEvent:vi.fn()
}));
vi.mock("../session-payments/audit",()=>({appendSessionAuditEvent:vi.fn()}));
vi.mock("../session-payments/proof",()=>({createProofReceipt:vi.fn()}));
vi.mock("../session-payments/providers/paypal",async importOriginal=>({
  ...await importOriginal<typeof import("../session-payments/providers/paypal")>(),verifyPayPalWebhook:vi.fn()
}));

const env:SessionPaymentEnv={DATABASE_URL:"postgres://test.invalid/db",APPROVAL_SIGNING_SECRET:"test-signing-secret"};
let event:any,payment:any,session:any,receipt:any,debited:boolean,debitCount:number;
let saved:Map<string,any>;
const request=()=>new Request("https://worker.test/webhooks/paypal",{method:"POST",body:JSON.stringify(event)});
const deliver=()=>processSessionPayPalWebhook(env,request());

beforeEach(()=>{
  vi.resetAllMocks();
  vi.spyOn(console,"log").mockImplementation(()=>{});
  vi.spyOn(console,"error").mockImplementation(()=>{});
  saved=new Map();receipt=null;debited=false;debitCount=0;
  event={id:"WH-1",event_type:"PAYMENT.CAPTURE.COMPLETED",resource:{
    id:"CAP-1",amount:{value:"49.00",currency_code:"USD"},
    supplementary_data:{related_ids:{order_id:"ORDER-1",authorization_id:"AUTH-1"}}
  }};
  payment={sessionId:"ps_1",walletId:"iw_1",provider:"paypal",providerOrderId:"ORDER-1",
    providerAuthorizationId:"AUTH-1",providerCaptureId:"CAP-1",amount:49,currency:"USD",status:"CAPTURE_REQUESTED"};
  session={sessionId:"ps_1",walletId:"iw_1",status:"CAPTURE_PENDING",proofReceiptId:null,
    selectedProduct:{authorizationContext:{walletAmount:4091.5,walletCurrency:"INR"}}};
  vi.mocked(paypal.verifyPayPalWebhook).mockImplementation(async()=>({valid:true,verificationStatus:"SUCCESS",event}));
  vi.mocked(repo.getSessionPayment).mockImplementation(async()=>({...payment}));
  vi.mocked(repo.getSessionPaymentByCaptureId).mockImplementation(async()=>({...payment}));
  vi.mocked(repo.getSessionPaymentByProviderOrderId).mockImplementation(async()=>({...payment}));
  vi.mocked(sessions.getSession).mockImplementation(async()=>({...session}));
  vi.mocked(repo.getProofReceipt).mockImplementation(async()=>receipt);
  vi.mocked(repo.claimSessionWebhook).mockImplementation(async(_db,input)=>{
    if(saved.has(input.payloadHash)) return false;
    saved.set(input.payloadHash,{session_id:input.sessionId,payload:structuredClone(input.payload)});return true;
  });
  vi.mocked(repo.getVerifiedPayPalWebhook).mockImplementation(async(_db,hash)=>saved.get(hash)??null);
  vi.mocked(repo.applyWalletSpendOnce).mockImplementation(async()=>{
    const applied=!debited;
    if(applied){debited=true;debitCount++;}
    return {applied,ledgerId:"ledger-1",spentAmount:4091.5,remainingAuthority:5908.5};
  });
  vi.mocked(repo.markSessionPaymentCaptured).mockImplementation(async()=>{
    payment.status="COMPLETED";session.status="CAPTURED";
  });
  vi.mocked(proof.createProofReceipt).mockImplementation(async()=>{
    receipt??={receiptId:"pr_1",proofHash:"proof-hash"};session.proofReceiptId=receipt.receiptId;return receipt;
  });
});

describe("verified PayPal webhook finalization",()=>{
  it("settles verified USD evidence with the bound INR wallet amount",async()=>{
    expect((await deliver()).status).toBe(200);
    expect(session.status).toBe("CAPTURED");expect(session.proofReceiptId).toBe("pr_1");
    expect(repo.applyWalletSpendOnce).toHaveBeenCalledWith(env.DATABASE_URL,expect.objectContaining({
      amount:4091.5,currency:"INR",provider:"paypal",providerPaymentId:"CAP-1",providerLinkId:"ORDER-1",
      verifiedPayPalPayloadHash:expect.any(String)
    }));
    expect(console.log).toHaveBeenCalledWith("PAYPAL_PROOF_CREATED",expect.objectContaining({receiptId:"pr_1"}));
  });

  it("accepts twenty deliveries while debiting and generating proof once",async()=>{
    await deliver();
    for(let i=1;i<20;i++) expect(await (await deliver()).json()).toMatchObject({duplicate:true});
    expect(debitCount).toBe(1);expect(proof.createProofReceipt).toHaveBeenCalledTimes(1);
  });

  it("resumes after a failure immediately after the webhook claim",async()=>{
    vi.mocked(sessions.addEvent).mockRejectedValueOnce(new Error("event insert unavailable"));
    await expect(deliver()).rejects.toThrow("event insert unavailable");
    expect(saved.size).toBe(1);expect(debitCount).toBe(0);
    await deliver();expect(session.status).toBe("CAPTURED");expect(debitCount).toBe(1);
    expect(console.error).toHaveBeenCalledWith("PAYPAL_WEBHOOK_PROCESSING_ERROR",expect.objectContaining({sessionId:"ps_1"}));
  });

  it("reconciles a prior wallet debit when the session update failed",async()=>{
    vi.mocked(repo.markSessionPaymentCaptured).mockRejectedValueOnce(new Error("session update unavailable"));
    await expect(deliver()).rejects.toThrow("session update unavailable");
    expect(debitCount).toBe(1);expect(session.status).toBe("CAPTURE_PENDING");
    await deliver();expect(session.status).toBe("CAPTURED");expect(debitCount).toBe(1);
  });

  it("recovers proof after CAPTURED without another wallet debit",async()=>{
    vi.mocked(proof.createProofReceipt).mockRejectedValueOnce(new Error("proof unavailable"));
    await expect(deliver()).rejects.toThrow("proof unavailable");
    expect(session.status).toBe("CAPTURED");expect(receipt).toBeNull();
    await deliver();expect(session.proofReceiptId).toBe("pr_1");expect(debitCount).toBe(1);
  });

  it("repairs an existing receipt whose session link is missing",async()=>{
    session.status="CAPTURED";payment.status="COMPLETED";debited=true;
    receipt={receiptId:"pr_1",proofHash:"proof-hash"};
    await deliver();expect(session.proofReceiptId).toBe("pr_1");expect(debitCount).toBe(0);
  });

  it.each([
    ["amount","48.00","AMOUNT"],["amount","NaN","AMOUNT"],["currency","INR","CURRENCY"],
    ["capture","CAP-OTHER","CAPTURE"],["order","ORDER-OTHER","ORDER"],["authorization","AUTH-OTHER","AUTHORIZATION"]
  ])("rejects incorrect %s before claim or wallet debit",async(field,value,code)=>{
    if(field==="amount") event.resource.amount.value=value;
    if(field==="currency") event.resource.amount.currency_code=value;
    if(field==="capture") event.resource.id=value;
    if(field==="order") event.resource.supplementary_data.related_ids.order_id=value;
    if(field==="authorization") event.resource.supplementary_data.related_ids.authorization_id=value;
    await expect(deliver()).rejects.toThrow(code+"_MISMATCH");
    expect(repo.claimSessionWebhook).not.toHaveBeenCalled();expect(debitCount).toBe(0);
  });

  it("does not bypass validation for an already finalized duplicate",async()=>{
    await deliver();event.resource.amount.value="50.00";
    await expect(deliver()).rejects.toThrow("AMOUNT_MISMATCH");expect(debitCount).toBe(1);
  });

  it("never settles a failed signature verification",async()=>{
    vi.mocked(paypal.verifyPayPalWebhook).mockResolvedValue({valid:false,verificationStatus:"FAILURE",event});
    expect((await deliver()).status).toBe(401);
    expect(repo.claimSessionWebhook).not.toHaveBeenCalled();expect(debitCount).toBe(0);
  });

  it("rejects a session/payment wallet mismatch before settlement",async()=>{
    session.walletId="iw_other";
    await expect(deliver()).rejects.toThrow("PAYMENT_IDENTITY_MISMATCH");
    expect(repo.applyWalletSpendOnce).not.toHaveBeenCalled();
  });

  it("acknowledges durable queue handoff before settlement and requeues claimed evidence",async()=>{
    const send=vi.fn().mockResolvedValue(undefined);
    const queuedEnv={...env,PURCHASE_QUEUE:{send}};
    expect((await processSessionPayPalWebhook(queuedEnv,request())).status).toBe(202);
    expect(debitCount).toBe(0);
    await processSessionPayPalWebhook(queuedEnv,request());
    expect(send).toHaveBeenCalledTimes(2);
    const job=send.mock.calls[0][0];
    await finalizePayPalCaptureJob(env,job);await finalizePayPalCaptureJob(env,job);
    expect(debitCount).toBe(1);expect(session.status).toBe("CAPTURED");
  });

  it("does not acknowledge a failed queue send, and retries the claimed delivery",async()=>{
    const send=vi.fn().mockRejectedValueOnce(new Error("queue unavailable")).mockResolvedValue(undefined);
    const queuedEnv={...env,PURCHASE_QUEUE:{send}};
    await expect(processSessionPayPalWebhook(queuedEnv,request())).rejects.toThrow("queue unavailable");
    expect(saved.size).toBe(1);
    expect((await processSessionPayPalWebhook(queuedEnv,request())).status).toBe(202);
    await finalizePayPalCaptureJob(env,send.mock.calls[1][0]);expect(debitCount).toBe(1);
  });

  it("rejects queue jobs without persisted verified evidence",async()=>{
    await expect(finalizePayPalCaptureJob(env,{kind:"FINALIZE_PAYPAL_CAPTURE",payloadHash:"unknown"})).rejects.toThrow("VERIFIED_PAYPAL_WEBHOOK_NOT_FOUND");
    expect(debitCount).toBe(0);
  });

  it("reloads and revalidates identifiers in the queue consumer",async()=>{
    const send=vi.fn().mockResolvedValue(undefined);
    await processSessionPayPalWebhook({...env,PURCHASE_QUEUE:{send}},request());
    payment.providerCaptureId="CAP-OTHER";
    await expect(finalizePayPalCaptureJob(env,send.mock.calls[0][0])).rejects.toThrow("CAPTURE_MISMATCH");
    expect(debitCount).toBe(0);
  });

  it("protects completed payments against a late denial webhook",async()=>{
    await deliver();event.event_type="PAYMENT.CAPTURE.DENIED";
    await deliver();
    expect(repo.markSessionPaymentFailed).toHaveBeenCalledWith(env.DATABASE_URL,"ps_1","DENIED",true);
    expect(session.status).toBe("CAPTURED");
  });
  it("retries failed settlement jobs without acknowledging or downgrading the session",async()=>{
    const send=vi.fn().mockResolvedValue(undefined);
    await processSessionPayPalWebhook({...env,PURCHASE_QUEUE:{send}},request());
    const message={body:send.mock.calls[0][0],attempts:1,ack:vi.fn(),retry:vi.fn()};
    const queueEnv={...env,DATABASE_URL:"postgres://test.invalid/db",WAHA_BASE_URL:"",WAHA_API_KEY:""};
    vi.mocked(repo.markSessionPaymentCaptured).mockRejectedValueOnce(new Error("temporary update failure"));
    await handlePurchaseQueue({messages:[message]},queueEnv,{});
    expect(message.retry).toHaveBeenCalledTimes(1);expect(message.ack).not.toHaveBeenCalled();
    expect(debitCount).toBe(1);expect(session.status).toBe("CAPTURE_PENDING");
    await handlePurchaseQueue({messages:[message]},queueEnv,{});
    expect(message.ack).toHaveBeenCalledTimes(1);expect(debitCount).toBe(1);
    expect(session.status).toBe("CAPTURED");
  });

  it.each(["PAYPAL_WEBHOOK_VERIFIED","PAYMENT_CAPTURED","WALLET_SPEND_APPLIED"])(
    "resumes when audit append fails at %s",async eventType=>{
      let failed=false;
      vi.mocked(audit.appendSessionAuditEvent).mockImplementation(async(_db,_session,type)=>{
        if(type===eventType && !failed){failed=true;throw new Error("audit unavailable");}
        return {eventId:crypto.randomUUID()};
      });
      await expect(deliver()).rejects.toThrow("audit unavailable");
      expect(saved.size).toBe(1);
      await deliver();expect(session.status).toBe("CAPTURED");expect(debitCount).toBe(1);
    }
  );

});
