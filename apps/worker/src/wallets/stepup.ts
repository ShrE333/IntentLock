import type {IntentWallet, WalletTransaction, WalletEvaluation} from "./types";
import {canonicalWalletTransaction, sha256Hex, signStepUpToken} from "./crypto";
import {
  createOneTimeAuthorization,
  createStepUpRequest,
  getStepUpRequest,
  raiseWalletAutoLimit,
  resolveStepUp
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
  db:string,
  secret:string,
  wallet:IntentWallet,
  requestId:string,
  action:"ALLOW_ONCE"|"RAISE_LIMIT"|"REJECT"
){
  const row=await getStepUpRequest(db,requestId);
  if(!row) throw new Error("STEP_UP_REQUEST_NOT_FOUND");
  if(String(row.wallet_id)!==wallet.walletId) throw new Error("STEP_UP_WALLET_MISMATCH");
  if(String(row.status)!=="PENDING") throw new Error(`STEP_UP_ALREADY_${String(row.status)}`);
  if(new Date(String(row.expires_at)).getTime()<=Date.now()) throw new Error("STEP_UP_REQUEST_EXPIRED");

  const requestedAmount=Number(row.requested_amount);
  const quoteHash=String(row.quote_hash);

  if(action==="REJECT"){
    await resolveStepUp(db,requestId,"REJECTED",{action});
    return {decision:"REJECTED",paymentAllowed:false};
  }

  if(action==="RAISE_LIMIT"){
    // V10.9: a risk-driven STEP_UP asks for human consent,
    // not more spending authority. It is represented by
    // additional_authority_required = 0.
    if(Number(row.additional_authority_required)===0){
      throw new Error(
        "RISK_STEP_UP_REQUIRES_ALLOW_ONCE_OR_REJECT"
      );
    }
    if(requestedAmount>wallet.maxSingleTransaction)
      throw new Error("REQUEST_EXCEEDS_HARD_CEILING");

    const updated=await raiseWalletAutoLimit(db,wallet.walletId,requestedAmount);
    if(!updated) throw new Error("AUTO_LIMIT_UPDATE_FAILED");

    await resolveStepUp(db,requestId,"LIMIT_RAISED",{
      action,newAutoBuyLimit:requestedAmount
    });

    return {
      decision:"LIMIT_RAISED",
      paymentAllowed:true,
      newAutoBuyLimit:requestedAmount
    };
  }

  const authorizationId=`wota_${crypto.randomUUID()}`;
  const issuedAt=new Date().toISOString();
  const expiresAt=new Date(
    Math.min(
      new Date(String(row.expires_at)).getTime(),
      Date.now()+10*60*1000
    )
  ).toISOString();

  const payload={
    type:"INTENTLOCK_STEP_UP_ONCE" as const,
    authorizationId,
    requestId,
    walletId:wallet.walletId,
    quoteHash,
    amount:requestedAmount,
    issuedAt,
    expiresAt,
    nonce:crypto.randomUUID()
  };

  const token=await signStepUpToken(secret,payload);
  const tokenHash=await sha256Hex(token);

  const saved=await createOneTimeAuthorization(db,{
    authorizationId,
    requestId,walletId:wallet.walletId,quoteHash,
    amount:requestedAmount,tokenHash,expiresAt
  });

  await resolveStepUp(db,requestId,"APPROVED_ONCE",{
    action,
    authorizationId:String(saved.authorization_id)
  });

  return {
    decision:"APPROVED_ONCE",
    paymentAllowed:true,
    authorizationId:String(saved.authorization_id),
    token,
    quoteHash,
    amount:requestedAmount,
    expiresAt
  };
}
