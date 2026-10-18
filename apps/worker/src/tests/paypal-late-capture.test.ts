/// <reference types="node" />
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
import {applyWalletSpendOnce} from "../session-payments/repository";
const {sql}=vi.hoisted(()=>({sql:vi.fn()}));
vi.mock("@neondatabase/serverless",()=>({neon:()=>sql}));
let db:PGlite;
const input={sessionId:"ps_1",walletId:"iw_1",amount:4091.5,currency:"INR",provider:"paypal" as const,
  providerLinkId:"ORDER-1",providerPaymentId:"CAP-1",verifiedPayPalPayloadHash:"verified-hash"};
const spend=(overrides:Partial<typeof input>={})=>applyWalletSpendOnce("isolated",{...input,...overrides});
const migration=readFileSync(new URL("../../db/v11_0_3_late_capture.sql",import.meta.url),"utf8");
describe("late verified PayPal capture reconciliation (isolated PostgreSQL)",()=>{
  beforeAll(async()=>{
    db=new PGlite();
    sql.mockImplementation(async(parts:TemplateStringsArray,...params:unknown[])=>{
      const query=parts.reduce((s,p,i)=>s+(i?"$"+i:"")+p,"");
      return (await db.query(query,params)).rows;
    });
    await db.exec(`
      CREATE TABLE intent_wallets(wallet_id TEXT PRIMARY KEY,status TEXT,currency TEXT,
        total_authority NUMERIC,spent_amount NUMERIC DEFAULT 0,valid_until TIMESTAMPTZ,updated_at TIMESTAMPTZ);
      CREATE TABLE wallet_spend_ledger(ledger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id TEXT UNIQUE,wallet_id TEXT,amount NUMERIC,currency TEXT,provider TEXT,
        provider_link_id TEXT,provider_payment_id TEXT);
      CREATE TABLE session_payment_links(session_id TEXT PRIMARY KEY,wallet_id TEXT,provider TEXT,
        provider_order_id TEXT,provider_authorization_id TEXT,provider_capture_id TEXT,amount NUMERIC,
        currency TEXT,quote_hash TEXT,authorization_id TEXT,created_at TIMESTAMPTZ);
      CREATE TABLE purchase_sessions(session_id TEXT PRIMARY KEY,wallet_id TEXT,payment_provider TEXT,
        provider_order_id TEXT,provider_authorization_id TEXT,provider_capture_id TEXT,selected_product JSONB);
      CREATE TABLE session_payment_webhook_events(payload_hash TEXT PRIMARY KEY,session_id TEXT,
        provider TEXT,event_type TEXT,provider_link_id TEXT,provider_payment_id TEXT,payload JSONB);
      CREATE TABLE purchase_session_events(session_id TEXT,event_type TEXT,payload JSONB,occurred_at TIMESTAMPTZ);
    `);
    await db.exec(readFileSync(new URL("../../db/v11_0_2_capture_retry.sql",import.meta.url),"utf8"));
    await db.exec(migration);
  },30000);
  afterAll(async()=>{await db?.close();});
  beforeEach(async()=>{
    await db.exec(`
      TRUNCATE intent_wallets,wallet_spend_ledger,session_payment_links,purchase_sessions,
        session_payment_webhook_events,purchase_session_events;
      INSERT INTO intent_wallets(wallet_id,status,currency,total_authority,valid_until)
        VALUES('iw_1','ACTIVE','INR',10000,NOW()-INTERVAL '1 day');
      INSERT INTO session_payment_links VALUES('ps_1','iw_1','paypal','ORDER-1','AUTH-1','CAP-1',49,'USD','quote','once',NOW()-INTERVAL '3 days');
      INSERT INTO purchase_sessions VALUES('ps_1','iw_1','paypal','ORDER-1','AUTH-1','CAP-1',
        '{"authorizationContext":{"walletAmount":4091.5,"walletCurrency":"INR"}}');
      INSERT INTO session_payment_webhook_events VALUES('verified-hash','ps_1','paypal','PAYMENT.CAPTURE.COMPLETED','ORDER-1','CAP-1',
        '{"event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP-1","amount":{"value":"49.00","currency_code":"USD"},"supplementary_data":{"related_ids":{"order_id":"ORDER-1","authorization_id":"AUTH-1"}}}}');
      INSERT INTO purchase_session_events VALUES
        ('ps_1','PAYPAL_AUTHORIZED','{"providerOrderId":"ORDER-1","providerAuthorizationId":"AUTH-1","amount":49,"currency":"USD","quoteHash":"quote"}',NOW()-INTERVAL '2 days'),
        ('ps_1','PAYMENT_AUTHORITY_RECHECK_ALLOWED','{"amount":4091.5,"currency":"INR","quoteHash":"quote"}',NOW()-INTERVAL '2 days'+INTERVAL '1 minute'),
        ('ps_1','PAYPAL_CAPTURE_REQUESTED','{"providerAuthorizationId":"AUTH-1","providerCaptureId":"CAP-1","amount":49,"currency":"USD"}',NOW()-INTERVAL '2 days'+INTERVAL '2 minutes');
    `);
  });
  const assertNoDebit=async()=>{
    expect((await db.query("SELECT * FROM wallet_spend_ledger")).rows).toHaveLength(0);
    expect((await db.query<any>("SELECT spent_amount FROM intent_wallets")).rows[0].spent_amount).toBe("0");
  };
  it("settles after expiry using authorization and capture-request history; migration is repeatable",async()=>{
    await db.exec(migration);
    expect(await spend()).toMatchObject({applied:true,spentAmount:4091.5});
  });
  it("serializes twenty late deliveries to one debit",async()=>{
    const results=await Promise.all(Array.from({length:20},()=>spend()));
    expect(results.filter(r=>r.applied)).toHaveLength(1);
    expect((await db.query("SELECT * FROM wallet_spend_ledger")).rows).toHaveLength(1);
    expect(results.every(r=>r.spentAmount===4091.5)).toBe(true);
  });
  it("uses a durable pre-call request when the provider response was delayed past expiry",async()=>{
    await db.exec(`
      INSERT INTO purchase_session_events VALUES('ps_1','PAYPAL_CAPTURE_INITIATED',
        '{"providerOrderId":"ORDER-1","providerAuthorizationId":"AUTH-1","amount":49,"currency":"USD"}',
        NOW()-INTERVAL '2 days'+INTERVAL '2 minutes');
      UPDATE purchase_session_events SET occurred_at=NOW() WHERE event_type='PAYPAL_CAPTURE_REQUESTED';
    `);
    expect(await spend()).toMatchObject({applied:true,spentAmount:4091.5});
  });
  it("requires verified evidence even for a matching existing ledger",async()=>{
    await spend();
    await expect(spend({verifiedPayPalPayloadHash:"wrong"})).rejects.toThrow("VERIFIED_PAYPAL_CAPTURE_MISMATCH");
    await expect(spend({providerPaymentId:"wrong"})).rejects.toThrow("PAYMENT_IDENTITY_MISMATCH");
  });
  it.each([
    "UPDATE intent_wallets SET status='REVOKED'",
    "UPDATE intent_wallets SET currency='USD'",
    "UPDATE intent_wallets SET total_authority=10"
  ])("retains other wallet authority checks: %s",async statement=>{
    await db.exec(statement);await expect(spend()).rejects.toThrow();await assertNoDebit();
  });
  it.each([
    "UPDATE intent_wallets SET valid_until=NOW()-INTERVAL '4 days'",
    "UPDATE purchase_session_events SET occurred_at=NOW() WHERE event_type='PAYPAL_AUTHORIZED'",
    "UPDATE purchase_session_events SET occurred_at=NOW() WHERE event_type='PAYPAL_CAPTURE_REQUESTED'",
    "DELETE FROM purchase_session_events WHERE event_type='PAYPAL_AUTHORIZED'",
    "DELETE FROM purchase_session_events WHERE event_type='PAYMENT_AUTHORITY_RECHECK_ALLOWED'",
    "UPDATE purchase_session_events SET payload=jsonb_set(payload,'{quoteHash}','\"wrong\"') WHERE event_type='PAYMENT_AUTHORITY_RECHECK_ALLOWED'"
  ])("fails closed for invalid or missing historical authority: %s",async statement=>{
    await db.exec(statement);
    await expect(spend()).rejects.toThrow("PAYPAL_HISTORICAL_AUTHORITY_INVALID");
    await assertNoDebit();
  });
  it("honors an existing debit after expiry and revocation even if old authority history is unavailable",async()=>{
    await spend();
    await db.exec("DELETE FROM purchase_session_events; UPDATE intent_wallets SET status='REVOKED'");
    expect(await spend()).toMatchObject({applied:false,spentAmount:4091.5});
  });
  it.each([
    {amount:5000},{currency:"USD"},{provider:"razorpay" as any},
    {providerPaymentId:"CAP-OTHER"},{providerLinkId:"ORDER-OTHER"},
    {walletId:"iw_other"},{sessionId:"ps_other"},{verifiedPayPalPayloadHash:"unverified"}
  ])("rejects mismatched identity or evidence %j",async overrides=>{
    await expect(spend(overrides)).rejects.toThrow();await assertNoDebit();
  });
  it.each([
    "UPDATE session_payment_webhook_events SET payload=jsonb_set(payload,'{resource,amount,value}','\"48\"')",
    "UPDATE session_payment_webhook_events SET payload=jsonb_set(payload,'{resource,amount,currency_code}','\"INR\"')",
    "UPDATE session_payment_webhook_events SET payload=jsonb_set(payload,'{resource,supplementary_data,related_ids,authorization_id}','\"wrong\"')",
    "UPDATE session_payment_links SET wallet_id='wrong'"
  ])("rejects corrupted persisted evidence or binding: %s",async statement=>{
    await db.exec(statement);await expect(spend()).rejects.toThrow();await assertNoDebit();
  });
  it("does not debit again when proof fails and settlement is retried",async()=>{
    const proof=vi.fn().mockRejectedValueOnce(new Error("proof unavailable")).mockResolvedValue({receiptId:"pr_1"});
    const finish=async()=>{await spend();return proof();};
    await expect(finish()).rejects.toThrow("proof unavailable");
    await finish();
    expect((await db.query("SELECT * FROM wallet_spend_ledger")).rows).toHaveLength(1);
    expect((await db.query<any>("SELECT spent_amount FROM intent_wallets")).rows[0].spent_amount).toBe("4091.5");
  });
  it("preserves expiry rejection in the original function for new spending",async()=>{
    await expect(db.query("SELECT * FROM apply_intent_wallet_spend_once_v11('ps_1','iw_1',4091.5,'INR','paypal','ORDER-1','CAP-1')"))
      .rejects.toThrow("WALLET_EXPIRED");
    await assertNoDebit();
  });
});
