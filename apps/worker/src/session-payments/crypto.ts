import {canonicalJson,sha256Hex} from "../db/audit";

const enc=(v:string)=>new TextEncoder().encode(v);

export async function buildSessionPaymentIdempotencyKey(input:{
  sessionId:string;
  walletId:string;
  quoteHash:string;
  amount:number;
  currency:string;
}){
  const digest=await sha256Hex([
    "intentlock-session-payment-v1",
    input.sessionId,
    input.walletId,
    input.quoteHash,
    input.amount.toFixed(2),
    input.currency
  ].join("|"));

  return `intentlock:session-payment:${digest}`;
}

export async function signProofHash(secret:string,proofHash:string){
  const key=await crypto.subtle.importKey(
    "raw",
    enc(secret),
    {name:"HMAC",hash:"SHA-256"},
    false,
    ["sign"]
  );

  const sig=await crypto.subtle.sign(
    "HMAC",
    key,
    enc(`intentlock-proof-v1|${proofHash}`)
  );

  return [...new Uint8Array(sig)]
    .map(b=>b.toString(16).padStart(2,"0"))
    .join("");
}

export async function buildProofHash(payload:unknown){
  return sha256Hex(canonicalJson(payload));
}
