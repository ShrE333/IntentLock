import type {WalletTransaction,WalletDecision} from "../wallets/types";

export type ApiClient = {
  clientId:string;
  name:string;
  keyPrefix:string;
  scopes:string[];
  status:"ACTIVE"|"REVOKED";
};

export type AuthorizeRequest = {
  idempotencyKey:string;
  agentId:string;
  walletId:string;
  merchant:string;
  transaction:WalletTransaction;
  quoteHash?:string;
};

export type AuthorizationTokenPayload = {
  type:"INTENTLOCK_AUTH_V1";
  authorizationId:string;
  requestId:string;
  clientId:string;
  agentId:string;
  walletId:string;
  merchant:string;
  quoteHash:string;
  amount:number;
  currency:string;
  decision:"ALLOW";
  issuedAt:string;
  expiresAt:string;
};

export type AuthorizeResponse = {
  requestId:string;
  idempotent:boolean;
  decision:WalletDecision;
  walletId:string;
  agentId:string;
  merchant:string;
  quoteHash:string;
  violations:string[];
  reasons:string[];
  remainingAuthority:number;
  additionalAuthorityRequired:number;
  stepUpRequestId:string|null;
  authorization:{
    authorizationId:string;
    token:string;
    expiresAt:string;
  }|null;
};
