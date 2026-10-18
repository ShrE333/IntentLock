/// <reference types="node" />
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";

const repaired=readFileSync(new URL("../../db/v11_0_2_capture_retry.sql",import.meta.url),"utf8");
const originalUpdate=repaired.replace("UPDATE intent_wallets AS w\n  SET spent_amount=w.spent_amount+p_amount,updated_at=NOW()\n  WHERE w.wallet_id=p_wallet_id\n  RETURNING w.* INTO v_wallet;",
  "UPDATE intent_wallets\n  SET spent_amount=spent_amount+p_amount,updated_at=NOW()\n  WHERE wallet_id=p_wallet_id\n  RETURNING * INTO v_wallet;");
let db:PGlite;
const spend=(amount=4091.5,currency="INR",capture="CAP-1")=>db.query(
  "SELECT * FROM apply_intent_wallet_spend_once_v11($1,$2,$3,$4,$5,$6,$7)",
  ["ps_1","iw_1",amount,currency,"paypal","ORDER-1",capture]
);

describe("PayPal wallet settlement SQL (isolated PostgreSQL)",()=>{
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`
      CREATE TABLE intent_wallets(
        wallet_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'ACTIVE',
        currency TEXT NOT NULL,total_authority NUMERIC NOT NULL,spent_amount NUMERIC NOT NULL DEFAULT 0,
        valid_until TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '1 day',updated_at TIMESTAMPTZ
      );
      CREATE TABLE wallet_spend_ledger(
        ledger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),session_id TEXT UNIQUE NOT NULL,
        wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id),amount NUMERIC NOT NULL CHECK(amount>0),
        currency TEXT NOT NULL,provider TEXT NOT NULL,provider_link_id TEXT,provider_payment_id TEXT
      );
    `);
  },30000);
  beforeEach(async()=>{
    await db.exec("TRUNCATE wallet_spend_ledger,intent_wallets; INSERT INTO intent_wallets(wallet_id,currency,total_authority) VALUES('iw_1','INR',10000);");
    await db.exec(repaired);
  });
  afterAll(async()=>{await db?.close();});

  it("reproduces the original ambiguous spent_amount error and its atomic rollback",async()=>{
    expect(originalUpdate).not.toBe(repaired);
    await db.exec(originalUpdate);
    await expect(spend()).rejects.toMatchObject({code:"42702",message:expect.stringContaining('spent_amount')});
    expect((await db.query("SELECT * FROM wallet_spend_ledger")).rows).toHaveLength(0);
    expect((await db.query<{spent_amount:string}>("SELECT spent_amount FROM intent_wallets")).rows[0].spent_amount).toBe("0");
    await db.exec(repaired);
    expect((await spend()).rows[0]).toMatchObject({applied:true,spent_amount:"4091.5"});
  });

  it("debits once across twenty repeated/concurrent attempts",async()=>{
    const results=await Promise.all(Array.from({length:20},()=>spend()));
    expect(results.filter(r=>(r.rows[0] as any).applied)).toHaveLength(1);
    expect((await db.query("SELECT * FROM wallet_spend_ledger")).rows).toHaveLength(1);
    expect((await db.query<{spent_amount:string}>("SELECT spent_amount FROM intent_wallets")).rows[0].spent_amount).toBe("4091.5");
  });

  it("reconciles an existing debit even after wallet expiry or revocation",async()=>{
    await spend();
    await db.exec("UPDATE intent_wallets SET status='REVOKED',valid_until=NOW()-INTERVAL '1 day'");
    expect((await spend()).rows[0]).toMatchObject({applied:false,spent_amount:"4091.5"});
  });

  it.each([
    [5000,"INR","CAP-1"],[4091.5,"USD","CAP-1"],[4091.5,"INR","CAP-OTHER"]
  ])("rejects a conflicting replay (%s %s %s)",async(amount,currency,capture)=>{
    await spend();
    await expect(spend(amount as number,currency as string,capture as string)).rejects.toThrow("WALLET_LEDGER_PAYMENT_MISMATCH");
  });

  it.each([
    ["status='REVOKED'","WALLET_NOT_ACTIVE"],
    ["valid_until=NOW()-INTERVAL '1 day'","WALLET_EXPIRED"],
    ["currency='USD'","WALLET_CURRENCY_MISMATCH"],
    ["total_authority=10","WALLET_TOTAL_AUTHORITY_EXCEEDED"]
  ])("preserves first-debit authority checks: %s",async(update,error)=>{
    await db.exec("UPDATE intent_wallets SET "+update);
    await expect(spend()).rejects.toThrow(error);
    expect((await db.query("SELECT * FROM wallet_spend_ledger")).rows).toHaveLength(0);
  });
});
