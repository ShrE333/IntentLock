import {neon} from "@neondatabase/serverless";
import type {IntentWallet, WalletEvaluation, WalletTransaction} from "./types";

const arr=(v:unknown):string[]=>Array.isArray(v)?v.map(String):[];
const num=(v:unknown)=>Number(v);

function mapWallet(r:any):IntentWallet{
  return {
    walletId:String(r.wallet_id), name:String(r.name), currency:String(r.currency).toUpperCase(),
    countryCode:String(r.country_code??"IN").toUpperCase(),
    totalAuthority:num(r.total_authority), spentAmount:num(r.spent_amount),
    reservedAmount:num(r.reserved_amount??0),
    autoBuyLimit:num(r.auto_buy_limit), maxSingleTransaction:num(r.max_single_transaction),
    allowedCategories:arr(r.allowed_categories), allowedBrands:arr(r.allowed_brands),
    blockedBrands:arr(r.blocked_brands), requiredFeatures:arr(r.required_features),
    excludedConditions:arr(r.excluded_conditions) as IntentWallet['excludedConditions'],
    validUntil:new Date(String(r.valid_until)).toISOString(),
    status:String(r.status) as "ACTIVE"|"REVOKED"
  };
}

export async function createWallet(db:string,input:any,ownerPrincipal?:string){
  const sql=neon(db);
  const id=`iw_${crypto.randomUUID()}`;
  const rows=await sql`
    WITH created AS (INSERT INTO intent_wallets(
      wallet_id,name,currency,country_code,total_authority,auto_buy_limit,max_single_transaction,
      allowed_categories,allowed_brands,blocked_brands,required_features,valid_until
    ) VALUES(
      ${id},${input.name},${input.currency},${input.countryCode??"IN"},${input.totalAuthority},
      ${input.autoBuyLimit},${input.maxSingleTransaction},
      ${JSON.stringify(input.allowedCategories)}::jsonb,
      ${JSON.stringify(input.allowedBrands)}::jsonb,
      ${JSON.stringify(input.blockedBrands)}::jsonb,
      ${JSON.stringify(input.requiredFeatures)}::jsonb,
      ${input.validUntil}
    ) RETURNING *), owned AS (
      INSERT INTO financial_resource_owners(resource_type,resource_id,principal_id)
      SELECT 'wallet',wallet_id,${ownerPrincipal??null}::text FROM created WHERE ${ownerPrincipal??null}::text IS NOT NULL
    ) SELECT * FROM created`;
  return mapWallet(rows[0]);
}

export const LIST_WALLETS_SQL=`SELECT w.* FROM intent_wallets w WHERE ($1::text IS NULL OR
 EXISTS(SELECT 1 FROM financial_resource_owners o WHERE o.resource_type='wallet' AND o.resource_id=w.wallet_id AND o.principal_id=$1)
 OR EXISTS(SELECT 1 FROM financial_wallet_grants g WHERE g.wallet_id=w.wallet_id AND g.principal_id=$1 AND 'read'=ANY(g.permissions) AND g.revoked_at IS NULL AND g.expires_at>NOW()))
 ORDER BY w.created_at DESC LIMIT 50`;
export async function listWallets(db:string,principalId?:string){
  const rows=await neon(db).query(LIST_WALLETS_SQL,[principalId??null]);
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
