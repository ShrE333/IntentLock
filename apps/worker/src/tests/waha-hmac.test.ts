import {describe,it,expect} from "vitest";
import {verifyWahaWebhookHmac} from "../whatsapp/waha-client";

const encoder=new TextEncoder();

async function makeHmac(secret:string,body:string){
  const key=await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {name:"HMAC",hash:"SHA-512"},
    false,
    ["sign"]
  );
  const sig=await crypto.subtle.sign("HMAC",key,encoder.encode(body));
  return [...new Uint8Array(sig)]
    .map(b=>b.toString(16).padStart(2,"0"))
    .join("");
}

describe("WAHA webhook HMAC",()=>{
  it("accepts a valid sha512 webhook signature",async()=>{
    const secret="test-webhook-secret";
    const body='{"event":"message","session":"default"}';
    const sig=await makeHmac(secret,body);

    expect(
      await verifyWahaWebhookHmac(secret,body,sig,"sha512")
    ).toBe(true);
  });

  it("rejects a modified body",async()=>{
    const secret="test-webhook-secret";
    const body='{"event":"message","session":"default"}';
    const sig=await makeHmac(secret,body);

    expect(
      await verifyWahaWebhookHmac(
        secret,
        body+" ",
        sig,
        "sha512"
      )
    ).toBe(false);
  });
});
