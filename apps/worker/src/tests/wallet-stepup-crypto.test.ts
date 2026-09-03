import {describe,it,expect} from "vitest";
import {
  canonicalWalletTransaction,
  sha256Hex,
  signStepUpToken,
  verifyStepUpToken
} from "../wallets/crypto";

describe("Intent Wallet step-up cryptography",()=>{
  const secret="test-only-secret";
  const tx={
    productName:"Sony Headphones",
    category:"electronics",
    brand:"Sony",
    amount:6499,
    currency:"INR",
    quantity:1,
    features:["wireless","ANC"]
  };

  it("binds the approval to the exact quote",async()=>{
    const original=await sha256Hex(canonicalWalletTransaction(tx));
    const changed=await sha256Hex(canonicalWalletTransaction({...tx,amount:6500}));
    expect(original).not.toBe(changed);
  });

  it("verifies a valid signed one-time approval",async()=>{
    const quoteHash=await sha256Hex(canonicalWalletTransaction(tx));
    const token=await signStepUpToken(secret,{
      type:"INTENTLOCK_STEP_UP_ONCE",
      authorizationId:"wota_test",
      requestId:"su_test",
      walletId:"iw_test",
      quoteHash,
      amount:6499,
      issuedAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+60000).toISOString(),
      nonce:"nonce_test"
    });
    const result=await verifyStepUpToken(secret,token);
    expect(result.valid).toBe(true);
    expect(result.payload?.amount).toBe(6499);
  });

  it("rejects a tampered token",async()=>{
    const quoteHash=await sha256Hex(canonicalWalletTransaction(tx));
    const token=await signStepUpToken(secret,{
      type:"INTENTLOCK_STEP_UP_ONCE",
      authorizationId:"wota_test",
      requestId:"su_test",
      walletId:"iw_test",
      quoteHash,
      amount:6499,
      issuedAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+60000).toISOString(),
      nonce:"nonce_test"
    });
    const tampered=token.slice(0,-1)+(token.endsWith("A")?"B":"A");
    const result=await verifyStepUpToken(secret,tampered);
    expect(result.valid).toBe(false);
  });
});
