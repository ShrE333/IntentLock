import {describe,it,expect} from "vitest";
import {evaluateWalletTransaction,getWalletReadiness} from "../wallets/policy";
import type {IntentWallet,WalletTransaction} from "../wallets/types";

const baseWallet:IntentWallet={
  walletId:"iw_dynamic",name:"Dynamic",countryCode:"IN",currency:"INR",
  totalAuthority:10000,spentAmount:0,autoBuyLimit:6000,maxSingleTransaction:7500,
  allowedCategories:["electronics"],allowedBrands:["Sony","Bose"],blockedBrands:["Boat"],
  requiredFeatures:["wireless","ANC"],validUntil:"2099-01-01T00:00:00.000Z",status:"ACTIVE"
};

const tx:WalletTransaction={
  productName:"Sony ANC",category:"electronics",brand:"Sony",amount:5000,currency:"INR",
  quantity:1,features:["wireless","ANC"]
};

describe("wallet decisions are data-driven, not hard-coded",()=>{
  it("allows the same transaction when it is inside authority",()=>{
    expect(evaluateWalletTransaction(baseWallet,tx).decision).toBe("ALLOW");
  });

  it("changes the same transaction to STEP_UP when only the autonomous limit changes",()=>{
    const wallet={...baseWallet,autoBuyLimit:4000};
    expect(evaluateWalletTransaction(wallet,tx).decision).toBe("STEP_UP");
  });

  it("changes the same transaction to BLOCK when remaining authority changes",()=>{
    const wallet={...baseWallet,spentAmount:6500};
    const result=evaluateWalletTransaction(wallet,tx);
    expect(result.decision).toBe("BLOCK");
    expect(result.violations).toContain("REMAINING_AUTHORITY_EXCEEDED");
  });

  it("blocks a brand only when wallet policy says so",()=>{
    const result=evaluateWalletTransaction(baseWallet,{...tx,brand:"Boat"});
    expect(result.decision).toBe("BLOCK");
    expect(result.violations).toContain("BRAND_BLOCKED");
  });

  it("reports expired wallets before a purchase session is created",()=>{
    const wallet={...baseWallet,validUntil:"2020-01-01T00:00:00.000Z"};
    expect(getWalletReadiness(wallet,new Date("2026-10-19T00:00:00.000Z")).code).toBe("WALLET_EXPIRED");
  });
});
