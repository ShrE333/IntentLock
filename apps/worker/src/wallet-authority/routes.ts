import {z} from 'zod';
import {neon} from '@neondatabase/serverless';
import {identityOf} from '../access/identity';
import {boundedBody} from '../access/gate';
import {WalletTransactionSchema} from '../wallets/validation';
import {evaluateWalletTransaction} from '../wallets/policy';
import {getWallet} from '../wallets/repository';
import {compileWalletInstruction,DraftWalletPolicySchema,policyDigest} from './compiler';
import {saveDraft,ownedDraft,confirmDraft} from './repository';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
type Env={DATABASE_URL?:string;NATURAL_LANGUAGE_WALLETS_ENABLED?:string};
const id=z.string().regex(/^wad_[a-f0-9-]{36}$/);
export async function handleAuthorityRoutes(request:Request,env:Env,url:URL):Promise<Response|null>{
 if(!url.pathname.startsWith('/api/wallet-authority'))return null;
 if(env.NATURAL_LANGUAGE_WALLETS_ENABLED!=='true')return json({error:'WALLET_AUTHORITY_DISABLED'},503);
 const identity=identityOf(env);
 if(!env.DATABASE_URL||!identity)return json({error:'AUTHENTICATION_REQUIRED'},401);
 const db=env.DATABASE_URL;
 try{
  const history=url.pathname.match(/^\/api\/wallet-authority\/history\/([^/]+)$/);
  if(request.method==='GET'&&history){
   const rows=await neon(db).query('SELECT version,canonical_policy,policy_digest,created_at FROM wallet_policy_versions WHERE wallet_id=$1 ORDER BY version',[decodeURIComponent(history[1])]);
   return json({versions:rows});
  }
  if(request.method!=='POST')return json({error:'NOT_FOUND'},404);
  const b=await boundedBody(request);
  if(url.pathname==='/api/wallet-authority/compile'){
   const {instruction}=z.object({instruction:z.string().min(1).max(4000)}).strict().parse(b);
   const result=compileWalletInstruction(instruction);
   const draft=result.ready?await saveDraft(db,identity.principalId,DraftWalletPolicySchema.parse(result.policy),result.provenance):null;
   return json({...result,draft});
  }
  if(url.pathname==='/api/wallet-authority/preview'){
   // Explicit structured human edits generate a fresh challenge. They do not
   // modify a persisted wallet or mutate an existing confirmation.
   const {policy}=z.object({policy:DraftWalletPolicySchema}).strict().parse(b);
   return json({draft:await saveDraft(db,identity.principalId,policy,{source:'STRUCTURED_REVIEW',inferredAuthority:false})});
  }
  const {draftId,digest}=z.object({draftId:id,digest:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough().parse(b);
  const draft=await ownedDraft(db,draftId,identity.principalId);
  if(!draft)return json({error:'DRAFT_NOT_FOUND'},404);
  if(draft.policy_digest!==digest||draft.confirmed_at||Date.parse(String(draft.expires_at))<=Date.now())return json({error:'DRAFT_STALE_TAMPERED_OR_CONSUMED'},409);
  const policy=DraftWalletPolicySchema.parse(JSON.parse(String(draft.canonical_policy)));
  if(await policyDigest(policy)!==digest)return json({error:'DRAFT_INTEGRITY_FAILED'},409);
  if(url.pathname==='/api/wallet-authority/confirm'){
   z.object({draftId:id,digest:z.string(),humanConfirmed:z.literal(true)}).strict().parse(b);
   // Machine API credentials and WhatsApp agents cannot confirm human mandates.
   if(!['ops','demo'].includes(identity.kind))return json({error:'HUMAN_SESSION_REQUIRED'},403);
   if(identity.kind==='demo'&&(policy.currency!=='USD'||policy.totalAuthority>100||policy.maxSingleTransaction>100||Date.parse(policy.validUntil)>Date.now()+86400000))
    return json({error:'DEMO_AUTHORITY_LIMIT'},403);
   const activated=await confirmDraft(db,draftId,identity.principalId,digest);
   if(!activated)return json({error:'DRAFT_CONFIRMATION_CONFLICT'},409);
   return json({wallet:await getWallet(db,String(activated.wallet_id)),digest},201);
  }
  if(url.pathname==='/api/wallet-authority/simulate'){
   const input=z.object({draftId:id,digest:z.string(),transaction:WalletTransactionSchema,mode:z.enum(['HYPOTHETICAL','SHOPIFY_DISCOVERY'])}).strict().parse(b);
   const tx=input.mode==='SHOPIFY_DISCOVERY'?{...input.transaction,brand:'',category:'',features:[]}:input.transaction;
   const wallet={...policy,walletId:'simulation',spentAmount:0,status:'ACTIVE' as const};
   const evaluation=evaluateWalletTransaction(wallet,tx);
   return json({state:'SIMULATION_ONLY',mode:input.mode,evaluation:{...evaluation,canAutoExecute:false},
    notice:'Hypothetical deterministic policy test. No risk clearance, approval grant, reservation, checkout or payment is issued.'});
  }
  return json({error:'NOT_FOUND'},404);
 }catch(error){
  if(error instanceof z.ZodError)return json({error:'INVALID_POLICY_REQUEST',message:'Please review: '+error.issues.map(i=>i.path.join('.')+': '+i.message).join('; '),issues:error.issues.map(i=>({path:i.path,message:i.message}))},400);
  return json({error:'WALLET_AUTHORITY_UNAVAILABLE'},503);
 }
}
