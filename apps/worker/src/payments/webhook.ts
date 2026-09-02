function enc(v:string){ return new TextEncoder().encode(v); }
function hex(bytes:Uint8Array){ return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join(''); }

export async function sha256Hex(value:string){
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(value))));
}

export async function verifyRazorpayWebhook(rawBody:string, signature:string|null, secret?:string){
  if(!signature || !secret) return false;
  const key = await crypto.subtle.importKey('raw', enc(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const expected = hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc(rawBody))));
  if(expected.length !== signature.length) return false;
  let diff=0;
  for(let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i)^signature.toLowerCase().charCodeAt(i);
  return diff===0;
}
