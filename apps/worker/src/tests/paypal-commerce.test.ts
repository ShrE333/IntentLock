import {describe,it,expect} from "vitest";
import {PayPalDemoMarketplaceConnector} from "../commerce/paypal-demo-connector";
import {authorizeProductContext} from "../payments/authorization-context";
import {evaluateWalletTransaction} from "../wallets/policy";
import type {IntentWallet} from "../wallets/types";

const wallet:IntentWallet={
  walletId:"iw_in",name:"Global demo",countryCode:"IN",currency:"INR",
  totalAuthority:10000,spentAmount:0,autoBuyLimit:6000,maxSingleTransaction:7500,
  allowedCategories:["electronics"],allowedBrands:["Sony","Bose"],
  blockedBrands:["Boat"],requiredFeatures:["wireless","ANC"],
  validUntil:"2099-01-01T00:00:00.000Z",status:"ACTIVE"
};

describe("PayPal multi-currency demo commerce connector",()=>{
  it("provides deterministic products across multiple presentment currencies",async()=>{
    const connector=new PayPalDemoMarketplaceConnector();
    const products=await connector.search({
      query:"wireless ANC headphones",category:"electronics",
      brands:["Sony","Bose"],requiredFeatures:["wireless","ANC"],limit:10
    });
    expect(products.length).toBeGreaterThan(0);
    expect(new Set(products.map(p=>p.currency)).size).toBeGreaterThan(1);
    expect(products.some(p=>p.currency==="USD")).toBe(true);
    expect(products.some(p=>p.currency==="EUR")).toBe(true);
  });

  it("normalizes merchant currency before deterministic wallet policy",async()=>{
    const connector=new PayPalDemoMarketplaceConnector();
    const sony=(await connector.search({query:"Sony",limit:25})).find(p=>p.id==="pp_sony_49")!;
    const normalized=await authorizeProductContext({FX_PROVIDER:"static"},wallet,sony);
    const result=evaluateWalletTransaction(wallet,normalized.transaction);
    expect(normalized.transaction.currency).toBe("INR");
    expect(normalized.transaction.presentmentCurrency).toBe("USD");
    expect(result.decision).toBe("ALLOW");
  });

  it("keeps adversarial merchant text untrusted and outside authority",async()=>{
    const connector=new PayPalDemoMarketplaceConnector();
    const products=await connector.search({query:"Sony",limit:25});
    const attack=products.find(p=>p.id==="pp_attack_64")!;
    expect(attack.merchantMessage).toContain("Ignore");

    const normalized=await authorizeProductContext({FX_PROVIDER:"static"},wallet,attack);
    const result=evaluateWalletTransaction(wallet,normalized.transaction);
    // Decision is based on structured amount/brand/features, never merchant prose.
    expect(["STEP_UP","BLOCK"]).toContain(result.decision);
  });
});
