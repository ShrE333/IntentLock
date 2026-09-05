import type {AuthorizationTokenPayload} from "./types";

const enc=new TextEncoder();

function b64url(bytes:Uint8Array){
  let s="";
  for(const b of bytes) s+=String.fromCharCode(b);
  return btoa(s)
    .replace(/\+/g,"-")
    .replace(/\//g,"_")
    .replace(/=+$/g,"");
}

function fromB64url(value:string){
  if(!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("INVALID_BASE64URL");

  const padded=value.replace(/-/g,"+").replace(/_/g,"/")
    +"=".repeat((4-value.length%4)%4);
  const raw=atob(padded);
  return new Uint8Array([...raw].map(c=>c.charCodeAt(0)));
}

function fromCanonicalB64url(value:string){
  const decoded=fromB64url(value);

  // Enforce a unique Base64URL textual representation.
  if(b64url(decoded)!==value)
    throw new Error("NON_CANONICAL_BASE64URL");

  return decoded;
}

export async function sha256(value:string){
  const d=await crypto.subtle.digest("SHA-256",enc.encode(value));
  return [...new Uint8Array(d)]
    .map(b=>b.toString(16).padStart(2,"0"))
    .join("");
}

async function hmac(secret:string,value:string){
  const key=await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    {name:"HMAC",hash:"SHA-256"},
    false,
    ["sign"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC",key,enc.encode(value))
  );
}

export async function signAuthorizationToken(
  secret:string,
  payload:AuthorizationTokenPayload
){
  const body=b64url(enc.encode(JSON.stringify(payload)));
  const sig=b64url(
    await hmac(secret,`intentlock-auth-v1|${body}`)
  );
  return `${body}.${sig}`;
}

export async function verifyAuthorizationToken(
  secret:string,
  token:string
):Promise<{
  valid:boolean;
  payload?:AuthorizationTokenPayload;
  reason?:string;
}>{
  const [body,sig,extra]=token.split(".");
  if(!body||!sig||extra)
    return {valid:false,reason:"MALFORMED_TOKEN"};

  let actual:Uint8Array;

  try{
    // Reject alternate encodings before signature verification.
    fromCanonicalB64url(body);
    actual=fromCanonicalB64url(sig);
  }catch{
    return {valid:false,reason:"NON_CANONICAL_TOKEN"};
  }

  const expected=await hmac(secret,`intentlock-auth-v1|${body}`);

  if(expected.length!==actual.length)
    return {valid:false,reason:"INVALID_SIGNATURE"};

  let diff=0;
  for(let i=0;i<expected.length;i++) diff|=expected[i]^actual[i];

  if(diff!==0)
    return {valid:false,reason:"INVALID_SIGNATURE"};

  try{
    const payload=JSON.parse(
      new TextDecoder().decode(fromCanonicalB64url(body))
    ) as AuthorizationTokenPayload;

    if(payload.type!=="INTENTLOCK_AUTH_V1")
      return {valid:false,reason:"INVALID_TOKEN_TYPE"};

    if(new Date(payload.expiresAt).getTime()<=Date.now())
      return {valid:false,reason:"TOKEN_EXPIRED"};

    return {valid:true,payload};
  }catch{
    return {valid:false,reason:"INVALID_PAYLOAD"};
  }
}

export function randomApiKey(){
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return `ilk_live_${b64url(bytes)}`;
}

export function safeEqualText(a:string,b:string){
  const aa=enc.encode(a);
  const bb=enc.encode(b);
  if(aa.length!==bb.length) return false;

  let diff=0;
  for(let i=0;i<aa.length;i++) diff|=aa[i]^bb[i];
  return diff===0;
}
