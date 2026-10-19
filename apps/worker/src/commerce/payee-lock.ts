import type {CommerceProduct} from "./types";
import type {PayeeLockBinding} from "../payments/context-types";
import {sha256Hex} from "../wallets/crypto";

export type PayeeLockEnv={
  PAYEELOCK_MODE?:string;
  PAYEELOCK_TRUSTED_PAYEES_JSON?:string;
};

type TrustedPayee={
  provider:string;
  payeeId:string;
  merchantCountry?:string;
  label?:string;
};

const clean=(value:unknown)=>String(value??"").trim();
const lower=(value:unknown)=>clean(value).toLowerCase();
const upper=(value:unknown)=>clean(value).toUpperCase();
const normalizeId=(value:unknown)=>lower(value).replace(/\s+/g," ");

export function payeeLockMode(env:PayeeLockEnv):"observe"|"enforce"{
  return lower(env.PAYEELOCK_MODE)==="enforce"?"enforce":"observe";
}

function parseTrustedPayees(env:PayeeLockEnv):TrustedPayee[]{
  const raw=clean(env.PAYEELOCK_TRUSTED_PAYEES_JSON);
  if(!raw) return [];
  try{
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed)) return [];
    return parsed
      .map((entry:any)=>({
        provider:lower(entry?.provider),
        payeeId:normalizeId(entry?.payeeId),
        merchantCountry:/^[A-Z]{2}$/.test(upper(entry?.merchantCountry))?upper(entry.merchantCountry):undefined,
        label:clean(entry?.label)||undefined
      }))
      .filter(x=>x.provider&&x.payeeId);
  }catch{
    throw new Error("PAYEELOCK_TRUSTED_PAYEES_JSON_INVALID");
  }
}

function providerFor(product:CommerceProduct){
  return lower(product.source?.provider||"commerce");
}

function payeeIdFor(product:CommerceProduct){
  const explicit=clean(product.source?.payeeId);
  if(explicit) return normalizeId(explicit);
  return normalizeId(product.merchant);
}

function payeeTypeFor(product:CommerceProduct){
  return clean(product.source?.payeeType||"MARKETPLACE_MERCHANT");
}

export async function buildPayeeLockBinding(
  env:PayeeLockEnv,
  product:CommerceProduct
):Promise<PayeeLockBinding>{
  const provider=providerFor(product);
  const payeeId=payeeIdFor(product);
  const merchantCountry=upper(product.merchantCountry||"ZZ");
  if(!provider||!payeeId) throw new Error("PAYEE_IDENTITY_UNAVAILABLE");

  const fingerprint=await sha256Hex(JSON.stringify({
    v:1,provider,payeeId,merchantCountry
  }));

  const mode=payeeLockMode(env);
  const registry=parseTrustedPayees(env);
  const exact=registry.find(entry=>
    entry.provider===provider&&
    entry.payeeId===payeeId&&
    (!entry.merchantCountry||entry.merchantCountry===merchantCountry)
  );

  const trustStatus:PayeeLockBinding["trustStatus"]=registry.length===0
    ?"REGISTRY_EMPTY"
    :exact?"TRUSTED":"UNREGISTERED";

  if(mode==="enforce"&&registry.length===0)
    throw new Error("PAYEELOCK_REGISTRY_REQUIRED");
  if(mode==="enforce"&&!exact)
    throw new Error("PAYEE_NOT_TRUSTED");

  return {
    provider,
    payeeId,
    payeeType:payeeTypeFor(product),
    merchantLabel:product.merchant,
    merchantCountry,
    fingerprint,
    mode,
    trustStatus,
    trustedLabel:exact?.label??null
  };
}

export async function assertPayeeIdentityStable(
  env:PayeeLockEnv,
  bound:PayeeLockBinding|undefined,
  freshProduct:CommerceProduct
){
  // Backward compatibility: sessions authorized before V11.2 never had a payee
  // fingerprint, so their historical quote hash and recovery semantics stay intact.
  if(!bound) return {binding:null,legacy:true};
  const fresh=await buildPayeeLockBinding(env,freshProduct);
  if(fresh.fingerprint!==bound.fingerprint)
    throw new Error("PAYEE_IDENTITY_CHANGED_REAUTHORIZE");
  return {binding:fresh,legacy:false};
}

export function publicPayeeLockConfig(env:PayeeLockEnv){
  const registry=parseTrustedPayees(env);
  return {
    mode:payeeLockMode(env),
    configured:registry.length>0,
    trustedPayeeCount:registry.length,
    trustedPayees:registry.map(x=>({
      provider:x.provider,payeeId:x.payeeId,
      merchantCountry:x.merchantCountry??null,label:x.label??null
    }))
  };
}
