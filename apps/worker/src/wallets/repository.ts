import {neon} from "@neondatabase/serverless";
import type {IntentWallet, WalletEvaluation, WalletTransaction} from "./types";

const arr=(v:unknown):string[]=>Array.isArray(v)?v.map(String):[];
const num=(v:unknown)=>Number(v);

function mapWallet(r:any):IntentWallet{
  return {
    walletId:String(r.wallet_id), name:String(r.name), currency:String(r.currency),
    totalAuthority:num(r.total_authority), spentAmount:num(r.spent_amount),
    autoBuyLimit:num(r.auto_buy_limit), maxSingleTransaction:num(r.max_single_transaction),
    allowedCategories:arr(r.allowed_categories), allowedBrands:arr(r.allowed_brands),
    blockedBrands:arr(r.blocked_brands), requiredFeatures:arr(r.required_features),
    validUntil:new Date(String(r.valid_until)).toISOString(),
    status:String(r.status) as "ACTIVE"|"REVOKED"
  };
}

export async function createWallet(db:string,input:any){
  const sql=neon(db);
  const id=`iw_${crypto.randomUUID()}`;
  const rows=await sql`
    INSERT INTO intent_wallets(
      wallet_id,name,currency,total_authority,auto_buy_limit,max_single_transaction,
      allowed_categories,allowed_brands,blocked_brands,required_features,valid_until
    ) VALUES(
      ${id},${input.name},${input.currency},${input.totalAuthority},
      ${input.autoBuyLimit},${input.maxSingleTransaction},
      ${JSON.stringify(input.allowedCategories)}::jsonb,
      ${JSON.stringify(input.allowedBrands)}::jsonb,
      ${JSON.stringify(input.blockedBrands)}::jsonb,
      ${JSON.stringify(input.requiredFeatures)}::jsonb,
      ${input.validUntil}
    ) RETURNING *`;
  return mapWallet(rows[0]);
}

export async function listWallets(db:string){
  const rows=await neon(db)`SELECT * FROM intent_wallets ORDER BY created_at DESC LIMIT 50`;
  return rows.map(mapWallet);
}

export async function getWallet(db:string,id:string){
  const rows=await neon(db)`SELECT * FROM intent_wallets WHERE wallet_id=${id} LIMIT 1`;
  return rows.length?mapWallet(rows[0]):null;
}

export async function recordDecision(db:string,walletId:string,tx:WalletTransaction,e:WalletEvaluation){
  const id=`wd_${crypto.randomUUID()}`;
  await neon(db)`
    INSERT INTO wallet_decisions(
      decision_id,wallet_id,transaction_payload,decision,reasons,
      remaining_authority,additional_authority_required
    ) VALUES(
      ${id},${walletId},${JSON.stringify(tx)}::jsonb,${e.decision},
      ${JSON.stringify([...e.violations,...e.reasons])}::jsonb,
      ${e.remainingAuthority},${e.additionalAuthorityRequired}
    )`;
  return id;
}
