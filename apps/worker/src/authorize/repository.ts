import {neon} from "@neondatabase/serverless";
import type {ApiClient,AuthorizeRequest} from "./types";

const arr=(v:unknown):string[]=>
  Array.isArray(v)?v.map(String):[];

function mapClient(r:any):ApiClient{
  return {
    clientId:String(r.client_id),
    name:String(r.name),
    keyPrefix:String(r.key_prefix),
    scopes:arr(r.scopes),
    status:String(r.status) as "ACTIVE"|"REVOKED"
  };
}

export async function createApiClient(
  db:string,
  input:{
    clientId:string;
    name:string;
    apiKeyHash:string;
    keyPrefix:string;
    scopes:string[];
  }
){
  const rows=await neon(db)`
    INSERT INTO api_clients(
      client_id,name,api_key_hash,key_prefix,scopes
    )
    VALUES(
      ${input.clientId},
      ${input.name},
      ${input.apiKeyHash},
      ${input.keyPrefix},
      ${JSON.stringify(input.scopes)}::jsonb
    )
    RETURNING *
  `;
  return mapClient(rows[0]);
}

export async function findApiClientByHash(
  db:string,
  apiKeyHash:string
){
  const rows=await neon(db)`
    SELECT *
    FROM api_clients
    WHERE api_key_hash=${apiKeyHash}
      AND status='ACTIVE'
    LIMIT 1
  `;

  if(!rows.length) return null;

  await neon(db)`
    UPDATE api_clients
    SET last_used_at=NOW()
    WHERE client_id=${String(rows[0].client_id)}
  `;

  return mapClient(rows[0]);
}

export async function revokeApiClient(
  db:string,
  clientId:string
){
  const rows=await neon(db)`
    UPDATE api_clients
    SET status='REVOKED'
    WHERE client_id=${clientId}
    RETURNING *
  `;
  return rows.length?mapClient(rows[0]):null;
}

export async function findAuthorizationByIdempotency(
  db:string,
  clientId:string,
  idempotencyKey:string
){
  const rows=await neon(db)`
    SELECT *
    FROM api_authorization_requests
    WHERE client_id=${clientId}
      AND idempotency_key=${idempotencyKey}
    LIMIT 1
  `;
  return rows[0]??null;
}

export async function createAuthorizationRequest(
  db:string,
  input:{
    requestId:string;
    clientId:string;
    idempotencyKey:string;
    agentId:string;
    walletId:string;
    merchant:string;
    transaction:AuthorizeRequest["transaction"];
    quoteHash:string;
    decision:"ALLOW"|"STEP_UP"|"BLOCK";
    violations:string[];
    reasons:string[];
    remainingAuthority:number;
    additionalAuthorityRequired:number;
    stepUpRequestId:string|null;
    authorizationId:string|null;
    expiresAt:string|null;
    issuedAt:string;
  }
){
  const rows=await neon(db)`
    INSERT INTO api_authorization_requests(
      request_id,client_id,idempotency_key,agent_id,wallet_id,merchant,
      transaction_payload,quote_hash,decision,violations,reasons,
      remaining_authority,additional_authority_required,
      step_up_request_id,authorization_id,expires_at,created_at
    )
    VALUES(
      ${input.requestId},
      ${input.clientId},
      ${input.idempotencyKey},
      ${input.agentId},
      ${input.walletId},
      ${input.merchant},
      ${JSON.stringify(input.transaction)}::jsonb,
      ${input.quoteHash},
      ${input.decision},
      ${JSON.stringify(input.violations)}::jsonb,
      ${JSON.stringify(input.reasons)}::jsonb,
      ${input.remainingAuthority},
      ${input.additionalAuthorityRequired},
      ${input.stepUpRequestId},
      ${input.authorizationId},
      ${input.expiresAt}::timestamptz,
      ${input.issuedAt}::timestamptz
    )
    RETURNING *
  `;
  return rows[0];
}

export async function setAuthorizationTokenHash(
  db:string,
  requestId:string,
  tokenHash:string
){
  await neon(db)`
    UPDATE api_authorization_requests
    SET token_hash=${tokenHash}
    WHERE request_id=${requestId}
  `;
}

export async function getAuthorizationById(
  db:string,
  authorizationId:string
){
  const rows=await neon(db)`
    SELECT *
    FROM api_authorization_requests
    WHERE authorization_id=${authorizationId}
    LIMIT 1
  `;
  return rows[0]??null;
}
