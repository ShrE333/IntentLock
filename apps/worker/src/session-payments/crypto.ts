import {canonicalJson,sha256Hex} from "../db/audit";
import type {PaymentProviderName} from "./providers/types";

const enc=(v:string)=>new TextEncoder().encode(v);

export async function buildSessionPaymentIdempotencyKey(input:{
  sessionId:string;
  walletId:string;
  quoteHash:string;
  amount:number;
  currency:string;
  provider?:PaymentProviderName;
}){
  const digest=await sha256Hex([
    "intentlock-session-payment-v2",
    input.provider??"razorpay",
    input.sessionId,
    input.walletId,
    input.quoteHash,
    input.amount.toFixed(2),
    input.currency.toUpperCase()
  ].join("|"));

  return `intentlock:session-payment:${digest}`;
}

export async function signProofHash(secret:string,proofHash:string){
  const key=await crypto.subtle.importKey(
    "raw",enc(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]
  );

  const sig=await crypto.subtle.sign(
    "HMAC",key,enc(`intentlock-proof-v1|${proofHash}`)
  );

  return [...new Uint8Array(sig)]
    .map(b=>b.toString(16).padStart(2,"0"))
    .join("");
}

export async function buildProofHash(payload:unknown){
  return sha256Hex(canonicalJson(payload));
}

export async function verifyReceiptIntegrity(receipt:{payload:unknown;proofHash:string;proofSignature:string},secret?:string){
  const computed=await buildProofHash(receipt.payload);
  const payloadHashValid=computed===receipt.proofHash;
  let signatureValid=false;
  if(secret&&/^[a-f0-9]{64}$/.test(receipt.proofSignature)){
    const key=await crypto.subtle.importKey('raw',enc(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const bytes=new Uint8Array(receipt.proofSignature.match(/../g)!.map(x=>parseInt(x,16)));
    signatureValid=await crypto.subtle.verify('HMAC',key,bytes,enc(`intentlock-proof-v1|${receipt.proofHash}`));
  }
  return {payloadHashValid,signatureValid};
}
