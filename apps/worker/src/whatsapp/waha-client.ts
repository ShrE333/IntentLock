const encoder=new TextEncoder();

function hex(bytes:Uint8Array){
  return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
}

export async function verifyWahaWebhookHmac(
  secret:string,
  rawBody:string,
  signature:string|null,
  algorithm:string|null
){
  if(!signature) return false;
  if((algorithm??"sha512").toLowerCase()!=="sha512") return false;

  const key=await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {name:"HMAC",hash:"SHA-512"},
    false,
    ["sign"]
  );

  const digest=await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody)
  );

  const expected=hex(new Uint8Array(digest)).toLowerCase();
  const actual=signature.trim().toLowerCase();

  if(expected.length!==actual.length) return false;

  let diff=0;
  for(let i=0;i<expected.length;i++){
    diff|=expected.charCodeAt(i)^actual.charCodeAt(i);
  }
  return diff===0;
}

export async function sendWahaText(input:{
  baseUrl:string;
  apiKey:string;
  session:string;
  chatId:string;
  text:string;
}){
  const response=await fetch(
    `${input.baseUrl.replace(/\/+$/,"")}/api/sendText`,
    {
      method:"POST",
      headers:{
        "content-type":"application/json",
        "X-Api-Key":input.apiKey
      },
      body:JSON.stringify({
        session:input.session,
        chatId:input.chatId,
        text:input.text
      })
    }
  );

  if(!response.ok){
    const body=await response.text();
    throw new Error(`WAHA_SEND_FAILED_${response.status}: ${body.slice(0,250)}`);
  }

  return response.json();
}
