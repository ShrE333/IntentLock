import {neon} from '@neondatabase/serverless';
import {canonicalPolicy,policyDigest,type DraftWalletPolicy} from './compiler';
export async function saveDraft(db:string,principal:string,policy:DraftWalletPolicy,provenance:unknown){
 const draftId='wad_'+crypto.randomUUID(),canonical=canonicalPolicy(policy),digest=await policyDigest(policy);
 const expiresAt=new Date(Math.min(Date.now()+10*60000,Date.parse(policy.validUntil))).toISOString();
 await neon(db).query('INSERT INTO wallet_authority_drafts(draft_id,principal_id,canonical_policy,policy_digest,provenance,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[draftId,principal,canonical,digest,JSON.stringify(provenance),expiresAt]);
 return {draftId,digest,expiresAt,canonicalPolicy:canonical,policy,state:'DRAFT_NOT_AUTHORIZED'};
}
export async function ownedDraft(db:string,id:string,principal:string){
 const rows=await neon(db).query('SELECT * FROM wallet_authority_drafts WHERE draft_id=$1 AND principal_id=$2',[id,principal]);
 return rows[0]??null;
}
// A row lock serializes competing confirmations; a failed statement rolls back
// the claim, wallet, ownership and policy-history trigger together.
export const CONFIRM_DRAFT_SQL=String.raw`
WITH claimed AS (
 UPDATE wallet_authority_drafts SET confirmed_at=NOW(),wallet_id=$4
 WHERE draft_id=$1 AND principal_id=$2 AND policy_digest=$3
 AND confirmed_at IS NULL AND expires_at>NOW()
 AND (canonical_policy::jsonb->>'validUntil')::timestamptz>NOW()
 RETURNING canonical_policy::jsonb p
), created AS (
 INSERT INTO intent_wallets(wallet_id,name,currency,country_code,total_authority,auto_buy_limit,max_single_transaction,
 allowed_categories,allowed_brands,blocked_brands,required_features,excluded_conditions,valid_until)
 SELECT $4,p->>'name',p->>'currency',p->>'countryCode',(p->>'totalAuthority')::numeric,
 (p->>'autoBuyLimit')::numeric,(p->>'maxSingleTransaction')::numeric,p->'allowedCategories',
 p->'allowedBrands',p->'blockedBrands',p->'requiredFeatures',p->'excludedConditions',(p->>'validUntil')::timestamptz FROM claimed
 RETURNING wallet_id
), owned AS (
 INSERT INTO financial_resource_owners(resource_type,resource_id,principal_id)
 SELECT 'wallet',wallet_id,$2 FROM created RETURNING resource_id
)
SELECT resource_id AS wallet_id FROM owned`;
export async function confirmDraft(db:string,id:string,principal:string,digest:string){
 const rows=await neon(db).query(CONFIRM_DRAFT_SQL,[id,principal,digest,'iw_'+crypto.randomUUID()]);
 return rows[0]??null;
}
