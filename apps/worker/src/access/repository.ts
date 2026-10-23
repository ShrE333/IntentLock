import {neon} from '@neondatabase/serverless';
import type {Permission} from './identity';

export const WALLET_ACCESS_SQL=`SELECT 1 FROM intent_wallets w WHERE w.wallet_id=$1 AND (
 EXISTS(SELECT 1 FROM financial_resource_owners o WHERE o.resource_type='wallet' AND o.resource_id=w.wallet_id AND o.principal_id=$2)
 OR EXISTS(SELECT 1 FROM financial_wallet_grants g WHERE g.wallet_id=w.wallet_id AND g.principal_id=$2
 AND $3=ANY(g.permissions) AND g.revoked_at IS NULL AND g.expires_at>NOW()))`;
export async function hasWalletPermission(db:string,walletId:string,principalId:string,permission:Permission){return (await neon(db).query(WALLET_ACCESS_SQL,[walletId,principalId,permission])).length===1;}
export async function ownsIntent(db:string,id:string,principalId:string){return (await neon(db)`SELECT 1 FROM financial_resource_owners WHERE resource_type='intent' AND resource_id=${id} AND principal_id=${principalId}`).length===1;}
export async function resourceWallet(db:string,kind:'session'|'refund'|'risk'|'stepup',id:string){
 const sql=neon(db);
 const rows=kind==='session'?await sql`SELECT wallet_id FROM purchase_sessions WHERE session_id=${id}`:
 kind==='refund'?await sql`SELECT s.wallet_id FROM session_refunds r JOIN purchase_sessions s ON s.session_id=r.session_id WHERE r.refund_id=${id}`:
 kind==='stepup'?await sql`SELECT wallet_id FROM wallet_step_up_requests WHERE request_id=${id}`:
 await sql`SELECT wallet_id FROM agent_risk_assessments WHERE session_id=${id}`;
 return rows.length?String(rows[0].wallet_id):null;
}
export async function isDemoSession(db:string,id:string){const rows=await neon(db)`SELECT 1 FROM purchase_sessions s JOIN intent_wallets w ON w.wallet_id=s.wallet_id WHERE s.session_id=${id} AND s.connector_id='paypal-demo-marketplace' AND w.currency='USD'`;return rows.length===1;}
export const RATE_LIMIT_SQL=`INSERT INTO financial_access_rate_limits(bucket,attempts,expires_at)
 VALUES($1,1,$2::timestamptz) ON CONFLICT(bucket) DO UPDATE SET
 attempts=CASE WHEN financial_access_rate_limits.expires_at<=NOW() THEN 1 ELSE financial_access_rate_limits.attempts+1 END,
 expires_at=CASE WHEN financial_access_rate_limits.expires_at<=NOW() THEN EXCLUDED.expires_at ELSE financial_access_rate_limits.expires_at END
 RETURNING attempts`;
export async function rateLimit(db:string,bucket:string,limit:number,seconds:number){
 const rows=await neon(db).query(RATE_LIMIT_SQL,[bucket,new Date(Date.now()+seconds*1000).toISOString()]);return Number(rows[0].attempts)<=limit;
}
export async function capabilityByHash(db:string,hash:string){const rows=await neon(db)`SELECT principal_id,expires_at FROM financial_demo_capabilities WHERE token_hash=${hash} AND revoked_at IS NULL AND expires_at>NOW()`;return rows[0]??null;}
export async function createCapability(db:string,hash:string,principalId:string,expiresAt:string){await neon(db)`INSERT INTO financial_demo_capabilities(token_hash,principal_id,expires_at) VALUES(${hash},${principalId},${expiresAt})`;}
export const ROTATE_CAPABILITY_SQL=`WITH revoked AS (
 UPDATE financial_demo_capabilities SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW() RETURNING principal_id
) INSERT INTO financial_demo_capabilities(token_hash,principal_id,expires_at) SELECT $2,principal_id,$3::timestamptz FROM revoked RETURNING principal_id`;
export async function rotateCapability(db:string,oldHash:string,newHash:string,expiresAt:string){return (await neon(db).query(ROTATE_CAPABILITY_SQL,[oldHash,newHash,expiresAt])).length===1;}
export async function revokeCapability(db:string,hash:string){await neon(db)`UPDATE financial_demo_capabilities SET revoked_at=NOW() WHERE token_hash=${hash}`;}
export const CLAIM_NONCE_SQL=`INSERT INTO financial_access_nonces(principal_id,request_id,expires_at) VALUES($1,$2,$3::timestamptz) ON CONFLICT DO NOTHING RETURNING request_id`;
export async function claimNonce(db:string,principal:string,id:string,expiry:string){return (await neon(db).query(CLAIM_NONCE_SQL,[principal,id,expiry])).length===1;}
