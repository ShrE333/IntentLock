/// <reference types="node" />
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../../db/v11_4_post_purchase_guard.sql",import.meta.url),"utf8");
let db:PGlite;
const apply=(refundId="rf_1",amount=2000,providerRefundId="R1")=>db.query(
  "SELECT * FROM apply_intent_wallet_refund_once_v11_4($1,$2,$3,$4,$5,$6,$7)",
  [refundId,"ps_1","iw_1",amount,"INR","paypal",providerRefundId]
);

describe("V11.4 replay-safe wallet refund ledger",()=>{
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`
      CREATE TABLE intent_wallets(
        wallet_id TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT 'w',currency TEXT NOT NULL,total_authority NUMERIC NOT NULL,
        spent_amount NUMERIC NOT NULL,status TEXT NOT NULL DEFAULT 'ACTIVE',valid_until TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '1 day',updated_at TIMESTAMPTZ
      );
      CREATE TABLE purchase_sessions(session_id TEXT PRIMARY KEY);
      CREATE TABLE session_payment_links(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),session_id TEXT UNIQUE NOT NULL REFERENCES purchase_sessions(session_id),
        wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id),provider TEXT NOT NULL,provider_capture_id TEXT,
        amount NUMERIC NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL
      );
      CREATE TABLE wallet_spend_ledger(
        ledger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),session_id TEXT UNIQUE NOT NULL,
        wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id),amount NUMERIC NOT NULL,currency TEXT NOT NULL,
        provider TEXT NOT NULL,provider_link_id TEXT,provider_payment_id TEXT,applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await db.exec(migration);
  },30000);
  beforeEach(async()=>{
    await db.exec(`
      TRUNCATE wallet_refund_ledger,session_refunds,wallet_spend_ledger,session_payment_links,purchase_sessions,intent_wallets CASCADE;
      INSERT INTO intent_wallets(wallet_id,currency,total_authority,spent_amount) VALUES('iw_1','INR',10000,4091.5);
      INSERT INTO purchase_sessions(session_id) VALUES('ps_1');
      INSERT INTO session_payment_links(session_id,wallet_id,provider,provider_capture_id,amount,currency,status)
      VALUES('ps_1','iw_1','paypal','CAP',49,'USD','COMPLETED');
      INSERT INTO wallet_spend_ledger(session_id,wallet_id,amount,currency,provider,provider_link_id,provider_payment_id)
      VALUES('ps_1','iw_1',4091.5,'INR','paypal','ORDER','CAP');
      INSERT INTO session_refunds(refund_id,session_id,wallet_id,provider,provider_capture_id,idempotency_key,reason,amount,currency,wallet_credit_amount,wallet_credit_currency,status)
      VALUES('rf_1','ps_1','iw_1','paypal','CAP',repeat('a',64),'CUSTOMER_REQUEST',24,'USD',2000,'INR','PROVIDER_ACCEPTED');
    `);
  });
  afterAll(async()=>{await db?.close();});

  it("restores wallet authority exactly once",async()=>{
    expect((await apply()).rows[0]).toMatchObject({applied:true,spent_amount:"2091.5"});
    expect((await apply()).rows[0]).toMatchObject({applied:false,spent_amount:"2091.5"});
    expect((await db.query("SELECT * FROM wallet_refund_ledger")).rows).toHaveLength(1);
  });

  it("allows refund reconciliation even if wallet later expired or was revoked",async()=>{
    await db.exec("UPDATE intent_wallets SET status='REVOKED',valid_until=NOW()-INTERVAL '1 day'");
    expect((await apply()).rows[0]).toMatchObject({applied:true});
  });

  it("never credits more than the original wallet debit",async()=>{
    await expect(apply("rf_1",5000,"R1")).rejects.toThrow("REFUND_EXCEEDS_ORIGINAL_WALLET_DEBIT");
  });
  it("atomically prevents two different refund reservations from exceeding the capture",async()=>{
    await db.exec("DELETE FROM session_refunds");
    const reserve=(id:string,key:string,amount:number)=>db.query(
      "SELECT * FROM reserve_session_refund_v11_4($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [id,"ps_1","iw_1","paypal","CAP",key,"CUSTOMER_REQUEST",amount,"USD",amount*83.5,"INR"]
    );
    await reserve("rf_a","b".repeat(64),30);
    await expect(reserve("rf_b","c".repeat(64),25)).rejects.toThrow("REFUND_EXCEEDS_REMAINING_CAPTURE");
  });

});
