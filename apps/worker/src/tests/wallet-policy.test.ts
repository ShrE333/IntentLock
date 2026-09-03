import {describe,it,expect} from "vitest";
import {evaluateWalletTransaction} from "../wallets/policy";

const wallet=(o:any={})=>({
  walletId:"iw_test",name:"Electronics",currency:"INR",
  totalAuthority:10000,spentAmount:0,autoBuyLimit:6000,maxSingleTransaction:7000,
  allowedCategories:["electronics"],allowedBrands:["Sony","Bose"],blockedBrands:["Boat"],
  requiredFeatures:["wireless","ANC"],validUntil:"2099-01-01T00:00:00.000Z",status:"ACTIVE",...o
});
const tx=(o:any={})=>({
  category:"electronics",brand:"Sony",amount:5899,currency:"INR",
  quantity:1,features:["wireless","ANC"],...o
});

describe("Intent Wallet policy",()=>{
  it("ALLOW under auto limit",()=>expect(evaluateWalletTransaction(wallet(),tx()).decision).toBe("ALLOW"));
  it("STEP_UP above auto limit",()=>{
    const r=evaluateWalletTransaction(wallet(),tx({amount:6499}));
    expect(r.decision).toBe("STEP_UP"); expect(r.additionalAuthorityRequired).toBe(499);
  });
  it("BLOCK above hard ceiling",()=>expect(evaluateWalletTransaction(wallet(),tx({amount:7500})).violations).toContain("MAX_SINGLE_TRANSACTION_EXCEEDED"));
  it("BLOCK blocked brand",()=>expect(evaluateWalletTransaction(wallet({allowedBrands:[]}),tx({brand:"Boat"})).violations).toContain("BRAND_BLOCKED"));
  it("BLOCK missing feature",()=>expect(evaluateWalletTransaction(wallet(),tx({features:["wireless"]})).violations).toContain("REQUIRED_FEATURE_MISSING"));
  it("BLOCK remaining authority",()=>expect(evaluateWalletTransaction(wallet({spentAmount:5000}),tx()).violations).toContain("REMAINING_AUTHORITY_EXCEEDED"));
  it("BLOCK expired wallet",()=>expect(evaluateWalletTransaction(wallet({validUntil:"2020-01-01T00:00:00.000Z"}),tx()).violations).toContain("WALLET_EXPIRED"));
});
