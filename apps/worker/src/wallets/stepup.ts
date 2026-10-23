import {resolveStepUpAtomic} from './atomic-stepup';
import {evaluateWalletTransaction} from './policy';
import type {IntentWallet, WalletTransaction, WalletEvaluation} from "./types";
import {canonicalWalletTransaction, sha256Hex, signStepUpToken} from "./crypto";
import {
  createStepUpRequest,
  getStepUpRequest
} from "./stepup-repository";

export async function issueStepUpRequest(
  db:string,
  wallet:IntentWallet,
  transaction:WalletTransaction,
  evaluation:WalletEvaluation
){
  if(evaluation.decision!=="STEP_UP") return null;

  const quoteHash=await sha256Hex(canonicalWalletTransaction(transaction));
  const expiresAt=new Date(Date.now()+10*60*1000).toISOString();

  const row=await createStepUpRequest(db,{
    walletId:wallet.walletId,
    transaction,
    quoteHash,
    requestedAmount:transaction.amount,
    currentAutoBuyLimit:wallet.autoBuyLimit,
    additionalAuthorityRequired:evaluation.additionalAuthorityRequired,
    expiresAt
  });

  return {
    requestId:String(row.request_id),
    status:String(row.status),
    quoteHash:String(row.quote_hash),
    requestedAmount:Number(row.requested_amount),
    currentAutoBuyLimit:Number(row.current_auto_buy_limit),
    additionalAuthorityRequired:Number(row.additional_authority_required),
    expiresAt:new Date(String(row.expires_at)).toISOString()
  };
}

export async function resolveStepUpRequest(
  db:string,secret:string,wallet:IntentWallet,requestId:string,
  action:"ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT"
){
  const row=await getStepUpRequest(db,requestId);
  if(!row) throw new Error('STEP_UP_REQUEST_NOT_FOUND');
  if(String(row.wallet_id)!==wallet.walletId) throw new Error('STEP_UP_WALLET_MISMATCH');
  if(row.status!=='PENDING') throw new Error('STEP_UP_ALREADY_'+row.status);
  if(Date.parse(String(row.expires_at))<=Date.now()) throw new Error('STEP_UP_REQUEST_EXPIRED');
  if(action!=='REJECT'&&evaluateWalletTransaction(wallet,row.transaction_payload as WalletTransaction).decision==='BLOCK')
    throw new Error('STEP_UP_AUTHORITY_INVALID');
  if(action==='RAISE_LIMIT'&&Number(row.additional_authority_required)===0)
    throw new Error('RISK_STEP_UP_REQUIRES_ALLOW_ONCE_OR_REJECT');
  const authorizationId='wota_'+crypto.randomUUID();
  const expiresAt=new Date(Math.min(Date.parse(String(row.expires_at)),Date.parse(wallet.validUntil),Date.now()+600000)).toISOString();
  const payload={type:'INTENTLOCK_STEP_UP_ONCE' as const,authorizationId,requestId,walletId:wallet.walletId,
    quoteHash:String(row.quote_hash),amount:Number(row.requested_amount),issuedAt:new Date().toISOString(),expiresAt,nonce:crypto.randomUUID()};
  const token=action==='ALLOW_ONCE'?await signStepUpToken(secret,payload):null;
  const status=action==='REJECT'?'REJECTED':action==='RAISE_LIMIT'?'LIMIT_RAISED':'APPROVED_ONCE';
  const saved=await resolveStepUpAtomic(db,[requestId,wallet.walletId,status,JSON.stringify({action,authorizationId:token?authorizationId:null}),
    payload.quoteHash,authorizationId,token?await sha256Hex(token):null,expiresAt]);
  return {decision:status,paymentAllowed:action!=='REJECT',
    ...(token?{authorizationId:String(saved.authorization_id),token,quoteHash:payload.quoteHash,amount:payload.amount,expiresAt}:{}),
    ...(action==='RAISE_LIMIT'?{newAutoBuyLimit:Number(saved.auto_buy_limit)}:{})};
}
