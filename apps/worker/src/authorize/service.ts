import {
  canonicalWalletTransaction,
  sha256Hex as walletSha256
} from "../wallets/crypto";
import {evaluateWalletTransaction} from "../wallets/policy";
import {
  getWallet,
  recordDecision
} from "../wallets/repository";
import {issueStepUpRequest} from "../wallets/stepup";
import type {WalletTransaction} from "../wallets/types";
import type {
  ApiClient,
  AuthorizeRequest,
  AuthorizeResponse,
  AuthorizationTokenPayload
} from "./types";
import {
  sha256,
  signAuthorizationToken,
  verifyAuthorizationToken
} from "./crypto";
import {
  createAuthorizationRequest,
  findAuthorizationByIdempotency,
  getAuthorizationById,
  setAuthorizationTokenHash
} from "./repository";

export type AuthorizeEnv={
  DATABASE_URL?:string;
  INTENTLOCK_AUTH_SIGNING_SECRET?:string;
};

function assertRequest(input:any):AuthorizeRequest{
  if(!input || typeof input!=="object")
    throw new Error("INVALID_REQUEST");

  for(const key of [
    "idempotencyKey","agentId","walletId","merchant"
  ]){
    if(typeof input[key]!=="string" || !input[key].trim())
      throw new Error(`MISSING_${key.toUpperCase()}`);
  }

  const tx=input.transaction;

  if(!tx || typeof tx!=="object")
    throw new Error("MISSING_TRANSACTION");

  if(typeof tx.category!=="string" || !tx.category.trim())
    throw new Error("MISSING_TRANSACTION_CATEGORY");

  if(typeof tx.brand!=="string" || !tx.brand.trim())
    throw new Error("MISSING_TRANSACTION_BRAND");

  if(!Number.isFinite(Number(tx.amount)) || Number(tx.amount)<=0)
    throw new Error("INVALID_TRANSACTION_AMOUNT");

  if(typeof tx.currency!=="string" || !tx.currency.trim())
    throw new Error("MISSING_TRANSACTION_CURRENCY");

  if(!Number.isInteger(Number(tx.quantity)) || Number(tx.quantity)<1)
    throw new Error("INVALID_TRANSACTION_QUANTITY");

  if(!Array.isArray(tx.features))
    throw new Error("INVALID_TRANSACTION_FEATURES");

  return {
    idempotencyKey:input.idempotencyKey.trim(),
    agentId:input.agentId.trim(),
    walletId:input.walletId.trim(),
    merchant:input.merchant.trim(),
    quoteHash:typeof input.quoteHash==="string"
      ? input.quoteHash.trim().toLowerCase()
      : undefined,
    transaction:{
      productName:typeof tx.productName==="string"
        ? tx.productName.trim()
        : undefined,
      category:tx.category.trim(),
      brand:tx.brand.trim(),
      amount:Number(tx.amount),
      currency:tx.currency.trim().toUpperCase(),
      quantity:Number(tx.quantity),
      features:tx.features.map(String)
    }
  };
}

function payloadFromRow(row:any):AuthorizationTokenPayload|null{
  if(String(row.decision)!=="ALLOW" || !row.authorization_id)
    return null;

  const tx=row.transaction_payload as WalletTransaction;

  return {
    type:"INTENTLOCK_AUTH_V1",
    authorizationId:String(row.authorization_id),
    requestId:String(row.request_id),
    clientId:String(row.client_id),
    agentId:String(row.agent_id),
    walletId:String(row.wallet_id),
    merchant:String(row.merchant),
    quoteHash:String(row.quote_hash),
    amount:Number(tx.amount),
    currency:String(tx.currency),
    decision:"ALLOW",
    issuedAt:new Date(String(row.created_at)).toISOString(),
    expiresAt:new Date(String(row.expires_at)).toISOString()
  };
}

async function responseFromRow(
  row:any,
  signingSecret:string,
  idempotent:boolean
):Promise<AuthorizeResponse>{
  let authorization:AuthorizeResponse["authorization"]=null;

  const payload=payloadFromRow(row);

  if(payload){
    const token=await signAuthorizationToken(
      signingSecret,
      payload
    );

    authorization={
      authorizationId:payload.authorizationId,
      token,
      expiresAt:payload.expiresAt
    };
  }

  return {
    requestId:String(row.request_id),
    idempotent,
    decision:String(row.decision) as AuthorizeResponse["decision"],
    walletId:String(row.wallet_id),
    agentId:String(row.agent_id),
    merchant:String(row.merchant),
    quoteHash:String(row.quote_hash),
    violations:Array.isArray(row.violations)?row.violations.map(String):[],
    reasons:Array.isArray(row.reasons)?row.reasons.map(String):[],
    remainingAuthority:Number(row.remaining_authority),
    additionalAuthorityRequired:Number(row.additional_authority_required),
    stepUpRequestId:row.step_up_request_id
      ? String(row.step_up_request_id)
      : null,
    authorization
  };
}

export async function authorizeTransaction(
  env:AuthorizeEnv,
  client:ApiClient,
  rawInput:unknown
):Promise<AuthorizeResponse>{
  if(!env.DATABASE_URL)
    throw new Error("DATABASE_NOT_CONFIGURED");

  if(!env.INTENTLOCK_AUTH_SIGNING_SECRET)
    throw new Error("AUTH_SIGNING_SECRET_NOT_CONFIGURED");

  const input=assertRequest(rawInput);

  const previous=await findAuthorizationByIdempotency(
    env.DATABASE_URL,
    client.clientId,
    input.idempotencyKey
  );

  if(previous){
    return responseFromRow(
      previous,
      env.INTENTLOCK_AUTH_SIGNING_SECRET,
      true
    );
  }

  const wallet=await getWallet(
    env.DATABASE_URL,
    input.walletId
  );

  if(!wallet)
    throw new Error("WALLET_NOT_FOUND");

  const canonical=canonicalWalletTransaction(
    input.transaction
  );

  const quoteHash=await walletSha256(canonical);

  if(input.quoteHash && input.quoteHash!==quoteHash){
    throw new Error("QUOTE_HASH_MISMATCH");
  }

  const evaluation=evaluateWalletTransaction(
    wallet,
    input.transaction
  );

  await recordDecision(
    env.DATABASE_URL,
    wallet.walletId,
    input.transaction,
    evaluation
  );

  let stepUpRequestId:string|null=null;

  if(evaluation.decision==="STEP_UP"){
    const stepUp=await issueStepUpRequest(
      env.DATABASE_URL,
      wallet,
      input.transaction,
      evaluation
    );

    stepUpRequestId=stepUp?.requestId??null;
  }

  const requestId=`ar_${crypto.randomUUID()}`;
  const authorizationId=evaluation.decision==="ALLOW"
    ? `auth_${crypto.randomUUID()}`
    : null;

  const issuedAt=new Date().toISOString();

  const expiresAt=evaluation.decision==="ALLOW"
    ? new Date(
        Math.min(
          new Date(wallet.validUntil).getTime(),
          Date.now()+5*60*1000
        )
      ).toISOString()
    : null;

  let row:any;

  try{
    row=await createAuthorizationRequest(
      env.DATABASE_URL,
      {
        requestId,
        clientId:client.clientId,
        idempotencyKey:input.idempotencyKey,
        agentId:input.agentId,
        walletId:input.walletId,
        merchant:input.merchant,
        transaction:input.transaction,
        quoteHash,
        decision:evaluation.decision,
        violations:evaluation.violations,
        reasons:evaluation.reasons,
        remainingAuthority:evaluation.remainingAuthority,
        additionalAuthorityRequired:
          evaluation.additionalAuthorityRequired,
        stepUpRequestId,
        authorizationId,
        expiresAt,
        issuedAt
      }
    );
  }catch(error){
    // Race-safe idempotency: if another identical retry won
    // the UNIQUE(client_id,idempotency_key), return that result.
    const raced=await findAuthorizationByIdempotency(
      env.DATABASE_URL,
      client.clientId,
      input.idempotencyKey
    );

    if(raced){
      return responseFromRow(
        raced,
        env.INTENTLOCK_AUTH_SIGNING_SECRET,
        true
      );
    }

    throw error;
  }

  if(authorizationId){
    const payload=payloadFromRow(row)!;

    const token=await signAuthorizationToken(
      env.INTENTLOCK_AUTH_SIGNING_SECRET,
      payload
    );

    await setAuthorizationTokenHash(
      env.DATABASE_URL,
      requestId,
      await sha256(token)
    );

    row={...row,token_hash:await sha256(token)};
  }

  return responseFromRow(
    row,
    env.INTENTLOCK_AUTH_SIGNING_SECRET,
    false
  );
}

export async function verifyStoredAuthorization(
  env:AuthorizeEnv,
  client:ApiClient,
  token:string
){
  if(!env.DATABASE_URL)
    throw new Error("DATABASE_NOT_CONFIGURED");

  if(!env.INTENTLOCK_AUTH_SIGNING_SECRET)
    throw new Error("AUTH_SIGNING_SECRET_NOT_CONFIGURED");

  const verified=await verifyAuthorizationToken(
    env.INTENTLOCK_AUTH_SIGNING_SECRET,
    token
  );

  if(!verified.valid || !verified.payload)
    return verified;

  if(verified.payload.clientId!==client.clientId)
    return {valid:false,reason:"CLIENT_MISMATCH"};

  const row=await getAuthorizationById(
    env.DATABASE_URL,
    verified.payload.authorizationId
  );

  if(!row)
    return {valid:false,reason:"AUTHORIZATION_NOT_FOUND"};

  if(String(row.client_id)!==client.clientId)
    return {valid:false,reason:"CLIENT_MISMATCH"};

  const tokenHash=await sha256(token);

  if(!row.token_hash || String(row.token_hash)!==tokenHash)
    return {valid:false,reason:"TOKEN_HASH_MISMATCH"};

  if(String(row.decision)!=="ALLOW")
    return {valid:false,reason:"AUTHORIZATION_NOT_ALLOWED"};

  return {
    valid:true,
    payload:verified.payload,
    requestId:String(row.request_id),
    quoteHash:String(row.quote_hash)
  };
}
