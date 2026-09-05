import {describe,it,expect} from "vitest";
import {
  canonicalWalletTransaction,
  sha256Hex,
  signStepUpToken,
  verifyStepUpToken
} from "../wallets/crypto";
import {
  signAuthorizationToken,
  verifyAuthorizationToken
} from "../authorize/crypto";

describe("V10.8.3 canonical signed-token encoding",()=>{
  it("rejects an alternate Base64URL representation of a step-up signature",async()=>{
    const quoteHash=await sha256Hex(
      canonicalWalletTransaction({
        productName:"Sony Headphones",
        category:"electronics",
        brand:"Sony",
        amount:6499,
        currency:"INR",
        quantity:1,
        features:["wireless","ANC"]
      })
    );

    const token=await signStepUpToken("secret",{
      type:"INTENTLOCK_STEP_UP_ONCE",
      authorizationId:"wota_1",
      requestId:"su_1",
      walletId:"iw_1",
      quoteHash,
      amount:6499,
      issuedAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+60000).toISOString(),
      nonce:"nonce"
    });

    const tampered=
      token.slice(0,-1)+(token.endsWith("A")?"B":"A");

    const result=await verifyStepUpToken("secret",tampered);
    expect(result.valid).toBe(false);
  });

  it("still verifies an untouched step-up token",async()=>{
    const quoteHash="a".repeat(64);

    const token=await signStepUpToken("secret",{
      type:"INTENTLOCK_STEP_UP_ONCE",
      authorizationId:"wota_1",
      requestId:"su_1",
      walletId:"iw_1",
      quoteHash,
      amount:6499,
      issuedAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+60000).toISOString(),
      nonce:"nonce"
    });

    expect((await verifyStepUpToken("secret",token)).valid).toBe(true);
  });

  it("rejects alternate encodings for external authorization tokens too",async()=>{
    const token=await signAuthorizationToken("secret",{
      type:"INTENTLOCK_AUTH_V1",
      authorizationId:"auth_1",
      requestId:"ar_1",
      clientId:"cli_1",
      agentId:"agent_1",
      walletId:"iw_1",
      merchant:"Shopify",
      quoteHash:"b".repeat(64),
      amount:5899,
      currency:"INR",
      decision:"ALLOW",
      issuedAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+60000).toISOString()
    });

    const tampered=
      token.slice(0,-1)+(token.endsWith("A")?"B":"A");

    expect(
      (await verifyAuthorizationToken("secret",tampered)).valid
    ).toBe(false);
  });
});
