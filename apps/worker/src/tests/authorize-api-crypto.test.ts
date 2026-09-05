import {describe,it,expect} from "vitest";
import {
  randomApiKey,
  sha256,
  signAuthorizationToken,
  verifyAuthorizationToken,
  safeEqualText
} from "../authorize/crypto";

describe("V10.8 authorization API crypto",()=>{
  it("generates IntentLock API keys with the expected prefix",()=>{
    const key=randomApiKey();
    expect(key.startsWith("ilk_live_")).toBe(true);
    expect(key.length).toBeGreaterThan(30);
  });

  it("signs and verifies an authorization token",async()=>{
    const token=await signAuthorizationToken("secret",{
      type:"INTENTLOCK_AUTH_V1",
      authorizationId:"auth_1",
      requestId:"ar_1",
      clientId:"cli_1",
      agentId:"agent_1",
      walletId:"iw_1",
      merchant:"Shopify",
      quoteHash:"a".repeat(64),
      amount:5899,
      currency:"INR",
      decision:"ALLOW",
      issuedAt:new Date(Date.now()-1000).toISOString(),
      expiresAt:new Date(Date.now()+60000).toISOString()
    });

    const verified=await verifyAuthorizationToken("secret",token);
    expect(verified.valid).toBe(true);
    expect(verified.payload?.authorizationId).toBe("auth_1");
  });

  it("rejects a tampered authorization token",async()=>{
    const token=await signAuthorizationToken("secret",{
      type:"INTENTLOCK_AUTH_V1",
      authorizationId:"auth_1",
      requestId:"ar_1",
      clientId:"cli_1",
      agentId:"agent_1",
      walletId:"iw_1",
      merchant:"Shopify",
      quoteHash:"a".repeat(64),
      amount:5899,
      currency:"INR",
      decision:"ALLOW",
      issuedAt:new Date(Date.now()-1000).toISOString(),
      expiresAt:new Date(Date.now()+60000).toISOString()
    });

    const broken=`${token.slice(0,-1)}${token.endsWith("A")?"B":"A"}`;
    const verified=await verifyAuthorizationToken("secret",broken);
    expect(verified.valid).toBe(false);
  });

  it("hashes API keys instead of storing plaintext",async()=>{
    const key=randomApiKey();
    const hash=await sha256(key);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(key);
  });

  it("compares pairing/admin secrets safely",()=>{
    expect(safeEqualText("abcdef","abcdef")).toBe(true);
    expect(safeEqualText("abcdef","abcdeg")).toBe(false);
  });
});
