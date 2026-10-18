/// <reference types="node" />
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {markPayPalAuthorized,markPayPalCaptureRequested,markSessionPaymentCaptured,markSessionPaymentFailed,persistProofReceipt} from "../session-payments/repository";
import {createProofReceipt} from "../session-payments/proof";

const mocks=vi.hoisted(()=>({sql:vi.fn()}));
vi.mock("@neondatabase/serverless",()=>({neon:()=>mocks.sql}));
let db:PGlite;
const state=async()=>({
  session:(await db.query<any>("SELECT * FROM purchase_sessions")).rows[0],
  payment:(await db.query<any>("SELECT * FROM session_payment_links")).rows[0]
});

describe("PayPal repository state and proof recovery (isolated PostgreSQL)",()=>{
  beforeAll(async()=>{
    db=new PGlite();
    mocks.sql.mockImplementation(async(parts:TemplateStringsArray,...params:unknown[])=>{
      const text=parts.reduce((s,p,i)=>s+(i?"$"+i:"")+p,"");
      return (await db.query(text,params)).rows;
    });
    await db.exec(`
      CREATE TABLE purchase_sessions(
        session_id TEXT PRIMARY KEY,status TEXT,payment_provider TEXT,provider_order_id TEXT,
        provider_capture_id TEXT,provider_authorization_id TEXT,razorpay_payment_link_id TEXT,razorpay_payment_id TEXT,
        captured_amount NUMERIC,captured_currency TEXT,captured_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,proof_receipt_id TEXT
      );
      CREATE TABLE session_payment_links(
        session_id TEXT PRIMARY KEY,provider TEXT,provider_order_id TEXT,provider_authorization_id TEXT,
        provider_capture_id TEXT,provider_payment_id TEXT,status TEXT,captured_at TIMESTAMPTZ,updated_at TIMESTAMPTZ
      );
      CREATE TABLE proof_receipts(
        receipt_id TEXT PRIMARY KEY,session_id TEXT UNIQUE,wallet_id TEXT,payload JSONB,
        proof_hash TEXT,proof_signature TEXT,evidence_audit_head_hash TEXT,created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  },30000);
  beforeEach(async()=>{
    await db.exec(`
      TRUNCATE purchase_sessions,session_payment_links,proof_receipts;
      INSERT INTO purchase_sessions(session_id,status) VALUES('ps_1','CAPTURE_PENDING');
      INSERT INTO session_payment_links(session_id,provider,provider_order_id,provider_capture_id,status)
      VALUES('ps_1','paypal','ORDER-1','CAP-1','CAPTURE_REQUESTED');
    `);
  });
  afterAll(async()=>{await db?.close();});
  const capture=()=>markSessionPaymentCaptured("isolated",{
    sessionId:"ps_1",provider:"paypal",providerOrderId:"ORDER-1",providerPaymentId:"CAP-1",amount:49,currency:"USD"
  });

  it("never downgrades captured state on a late capture API response, authorization or denial",async()=>{
    await capture();
    const before=await state();
    await markPayPalCaptureRequested("isolated",{sessionId:"ps_1",providerCaptureId:"CAP-1",status:"CAPTURE_REQUESTED"});
    await markPayPalAuthorized("isolated",{sessionId:"ps_1",providerOrderId:"ORDER-1",providerAuthorizationId:"AUTH-1",status:"AUTHORIZED"});
    await markSessionPaymentFailed("isolated","ps_1","DENIED",true);
    const after=await state();
    expect(after.session.status).toBe("CAPTURED");expect(after.payment.status).toBe("COMPLETED");
    expect(after.session.captured_at).toEqual(before.session.captured_at);
    await capture();
    expect((await state()).session.captured_at).toEqual(before.session.captured_at);
  });

  it("preserves Razorpay's existing failure update when no PayPal guard is requested",async()=>{
    await markSessionPaymentFailed("isolated","ps_1","FAILED");
    const result=await state();
    expect(result.session.status).toBe("FAILED");expect(result.payment.status).toBe("FAILED");
  });

  it("keeps the first signed receipt immutable across competing inserts",async()=>{
    const input={receiptId:"pr_first",sessionId:"ps_1",walletId:"iw_1",payload:{original:true},
      proofHash:"first-hash",proofSignature:"first-signature",evidenceAuditHeadHash:"head-1"};
    await persistProofReceipt("isolated",input);
    const other=await persistProofReceipt("isolated",{...input,receiptId:"pr_second",payload:{original:false},proofHash:"other-hash"});
    expect(other.receiptId).toBe("pr_first");expect(other.payload).toEqual({original:true});
    expect(other.proofHash).toBe("first-hash");
    expect((await db.query("SELECT * FROM proof_receipts")).rows).toHaveLength(1);
  });

  it("reattaches a saved proof after a session-link failure",async()=>{
    await capture();
    await persistProofReceipt("isolated",{receiptId:"pr_first",sessionId:"ps_1",walletId:"iw_1",payload:{},
      proofHash:"first-hash",proofSignature:"first-signature",evidenceAuditHeadHash:null});
    const proof=await createProofReceipt("isolated","test-secret","ps_1");
    expect(proof.receiptId).toBe("pr_first");
    expect((await state()).session.proof_receipt_id).toBe("pr_first");
  });
});
