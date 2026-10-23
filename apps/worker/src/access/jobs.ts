import {neon} from '@neondatabase/serverless';
import {whatsappPrincipal} from './identity';
import {hasWalletPermission,resourceWallet} from './repository';
import {isWhatsappChatAuthorized} from '../whatsapp/access';
export type InteractiveJob={kind:'RUN_PURCHASE'|'CREATE_PAYMENT';sessionId:string;chatId:string;wahaSession:string;jobId?:string};
export async function assertChatResource(db:string,chatId:string,kind:'wallet'|'session',id:string,permission:'read'|'execute'|'approve'){
 if(!await isWhatsappChatAuthorized(db,chatId))throw new Error('CHAT_ACCESS_REVOKED');
 const wallet=kind==='wallet'?id:await resourceWallet(db,'session',id);
 const principal=await whatsappPrincipal(chatId);
 if(!wallet||!await hasWalletPermission(db,wallet,principal,permission)||!await hasWalletPermission(db,wallet,principal,'read'))throw new Error('RESOURCE_NOT_FOUND');
}
export async function createExecutionJob(db:string,job:InteractiveJob){
 await assertChatResource(db,job.chatId,'session',job.sessionId,'execute');
 const principal=await whatsappPrincipal(job.chatId);const id=`job_${crypto.randomUUID()}`;
 const rows=await neon(db)`INSERT INTO financial_execution_jobs(job_id,session_id,principal_id,kind,chat_id,waha_session,expires_at)
 VALUES(${id},${job.sessionId},${principal},${job.kind},${job.chatId},${job.wahaSession},NOW()+INTERVAL '30 minutes')
 ON CONFLICT(session_id,kind) DO UPDATE SET job_id=financial_execution_jobs.job_id
 RETURNING job_id`;
 return {...job,jobId:String(rows[0].job_id)};
}
export const CLAIM_EXECUTION_JOB_SQL=`UPDATE financial_execution_jobs SET status='RUNNING',lease_until=NOW()+INTERVAL '5 minutes'
 WHERE job_id=$1 AND session_id=$2 AND principal_id=$3 AND kind=$4 AND chat_id=$5 AND waha_session=$6
 AND expires_at>NOW() AND (status='PENDING' OR (status='RUNNING' AND lease_until<NOW())) RETURNING job_id`;
export async function verifyInteractiveJob(db:string,job:InteractiveJob){
 if(!job.jobId)throw new Error('EXECUTION_IDENTITY_REQUIRED');
 await assertChatResource(db,job.chatId,'session',job.sessionId,'execute');
 const sql=neon(db),principal=await whatsappPrincipal(job.chatId);
 const rows=await sql.query(CLAIM_EXECUTION_JOB_SQL,[job.jobId,job.sessionId,principal,job.kind,job.chatId,job.wahaSession]);
 if(!rows.length){
   const saved=await sql`SELECT status FROM financial_execution_jobs WHERE job_id=${job.jobId} AND session_id=${job.sessionId} AND principal_id=${principal} AND kind=${job.kind} AND chat_id=${job.chatId} AND waha_session=${job.wahaSession}`;
   if(saved[0]?.status==='DONE')return false;
   throw new Error('EXECUTION_IDENTITY_INVALID_OR_BUSY');
 }
 return true;
}
export async function finishExecutionJob(db:string,id:string){await neon(db)`UPDATE financial_execution_jobs SET status='DONE',lease_until=NULL WHERE job_id=${id}`;}
export async function retryExecutionJob(db:string,id:string){await neon(db)`UPDATE financial_execution_jobs SET status='PENDING',lease_until=NULL WHERE job_id=${id} AND status='RUNNING'`;}
