import {neon} from "@neondatabase/serverless";
import type {WalletTransaction} from "./types";

export async function createStepUpRequest(
  db:string,
  input:{
    walletId:string;
    transaction:WalletTransaction;
    quoteHash:string;
    requestedAmount:number;
    currentAutoBuyLimit:number;
    additionalAuthorityRequired:number;
    expiresAt:string;
  }
){
  const sql=neon(db);
  const requestId=`su_${crypto.randomUUID()}`;

  const rows=await sql`
    INSERT INTO wallet_step_up_requests(
      request_id,wallet_id,transaction_payload,quote_hash,
      requested_amount,current_auto_buy_limit,additional_authority_required,
      status,expires_at
    ) VALUES(
      ${requestId},${input.walletId},${JSON.stringify(input.transaction)}::jsonb,
      ${input.quoteHash},${input.requestedAmount},${input.currentAutoBuyLimit},
      ${input.additionalAuthorityRequired},'PENDING',${input.expiresAt}
    )
    RETURNING *
  `;
  return rows[0] as any;
}

export async function getStepUpRequest(db:string,requestId:string){
  const rows=await neon(db)`
    SELECT * FROM wallet_step_up_requests
    WHERE request_id=${requestId}
    LIMIT 1
  `;
  return rows.length ? rows[0] as any : null;
}

export async function resolveStepUp(
  db:string,
  requestId:string,
  status:"APPROVED_ONCE"|"LIMIT_RAISED"|"REJECTED",
  payload:unknown
){
  const rows=await neon(db)`
    UPDATE wallet_step_up_requests
    SET status=${status}, resolved_at=NOW(),
        resolution_payload=${JSON.stringify(payload)}::jsonb
    WHERE request_id=${requestId}
      AND status='PENDING'
      AND expires_at > NOW()
    RETURNING *
  `;
  return rows.length ? rows[0] as any : null;
}

export async function raiseWalletAutoLimit(
  db:string,
  walletId:string,
  newLimit:number
){
  const rows=await neon(db)`
    UPDATE intent_wallets
    SET auto_buy_limit=${newLimit}, updated_at=NOW()
    WHERE wallet_id=${walletId}
      AND status='ACTIVE'
      AND ${newLimit} <= max_single_transaction
    RETURNING *
  `;
  return rows.length ? rows[0] as any : null;
}

export async function createOneTimeAuthorization(
  db:string,
  input:{
    authorizationId:string;
    requestId:string;
    walletId:string;
    quoteHash:string;
    amount:number;
    tokenHash:string;
    expiresAt:string;
  }
){
  const authorizationId=input.authorizationId;
  const rows=await neon(db)`
    INSERT INTO wallet_one_time_authorizations(
      authorization_id,request_id,wallet_id,quote_hash,amount,token_hash,expires_at
    ) VALUES(
      ${authorizationId},${input.requestId},${input.walletId},${input.quoteHash},
      ${input.amount},${input.tokenHash},${input.expiresAt}
    )
    RETURNING *
  `;
  return rows[0] as any;
}
