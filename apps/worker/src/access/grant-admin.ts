import {neon} from '@neondatabase/serverless';
import {safeEqualText} from '../authorize/crypto';
import {boundedBody,type FinancialAccessEnv} from './gate';
import {whatsappPrincipal} from './identity';
const json=(body:unknown,status:number)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function handleGrantAdmin(request:Request,env:FinancialAccessEnv){
 const supplied=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]??request.headers.get('x-intentlock-key')??'';
 if(!env.INTENTLOCK_ADMIN_KEY||!safeEqualText(supplied,env.INTENTLOCK_ADMIN_KEY))return json({error:'ADMIN_UNAUTHORIZED'},401);
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 if(!env.DATABASE_URL)return json({error:'ACCESS_CONTROL_UNAVAILABLE'},503);
 const path=new URL(request.url).pathname;if(!['/v1/admin/wallet-grants','/v1/admin/wallet-grants/revoke'].includes(path))return json({error:'NOT_FOUND'},404);
 const body=await boundedBody(request);
 if(typeof body.walletId!=='string'||(typeof body.clientId==='string')===(typeof body.chatId==='string'))return json({error:'CLIENT_OR_CHAT_AND_WALLET_REQUIRED'},400);
 const sql=neon(env.DATABASE_URL);const principal=typeof body.clientId==='string'?`api:${body.clientId}`:await whatsappPrincipal(body.chatId);
 const target=typeof body.clientId==='string'?await sql`SELECT status FROM api_clients WHERE client_id=${body.clientId}`:await sql`SELECT revoked_at FROM whatsapp_authorized_chats WHERE chat_id=${body.chatId}`;
 if(!target.length||(!path.endsWith('/revoke')&&(typeof body.clientId==='string'?target[0].status!=='ACTIVE':target[0].revoked_at!==null)))return json({error:'RESOURCE_NOT_FOUND'},404);
 if(path.endsWith('/revoke')){
   await sql`WITH changed AS (UPDATE financial_wallet_grants SET revoked_at=NOW() WHERE wallet_id=${body.walletId} AND principal_id=${principal} RETURNING *)
   INSERT INTO financial_access_admin_events(action,actor,wallet_id,principal_id,permissions) SELECT 'REVOKE','admin:api-key',wallet_id,principal_id,permissions FROM changed`;
   return json({ok:true},200);
 }
 const permissions=body.permissions??['read','authorize'];
 const expiry=body.expiresAt?Date.parse(body.expiresAt):Date.now()+3600000;
 if(!Array.isArray(permissions)||!permissions.length||permissions.some(p=>!['read','authorize','execute','approve'].includes(p))||!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+90*86400000)return json({error:'INVALID_GRANT'},400);
 const rows=await sql`WITH changed AS (
 INSERT INTO financial_wallet_grants(wallet_id,principal_id,permissions,expires_at,granted_by)
 SELECT w.wallet_id,${principal},${permissions}::text[],${new Date(expiry).toISOString()}::timestamptz,'admin:api-key'
 FROM intent_wallets w WHERE w.wallet_id=${body.walletId}
 ON CONFLICT(wallet_id,principal_id) DO UPDATE SET permissions=EXCLUDED.permissions,expires_at=EXCLUDED.expires_at,revoked_at=NULL,granted_by=EXCLUDED.granted_by
 RETURNING *), logged AS (
 INSERT INTO financial_access_admin_events(action,actor,wallet_id,principal_id,permissions)
 SELECT 'GRANT','admin:api-key',wallet_id,principal_id,permissions FROM changed
 ) SELECT wallet_id FROM changed`;
 return rows.length?json({ok:true,walletId:body.walletId,clientId:body.clientId,permissions,expiresAt:new Date(expiry).toISOString()},201):json({error:'RESOURCE_NOT_FOUND'},404);
}
