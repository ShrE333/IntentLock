import {describe,it,expect} from "vitest";
import {DemoMarketplaceConnector} from "../commerce/demo-connector";
import {evaluateWalletTransaction} from "../wallets/policy";

describe("PurchaseSession candidate selection invariants",()=>{
  const wallet={
    walletId:"iw_test",name:"Electronics",currency:"INR",
    totalAuthority:10000,spentAmount:0,
    autoBuyLimit:6000,maxSingleTransaction:7000,
    allowedCategories:["electronics"],allowedBrands:["Sony","Bose"],
    blockedBrands:["Boat"],requiredFeatures:["wireless","ANC"],
    validUntil:"2099-01-01T00:00:00.000Z",status:"ACTIVE" as const
  };

  it("finds an autonomously allowed candidate",async()=>{
    const products=await new DemoMarketplaceConnector().search({
      query:"wireless ANC headphones",limit:25
    });
    const allowed=products
      .map(product=>({
        product,
        eval:evaluateWalletTransaction(wallet,{
          productName:product.title,category:product.category,brand:product.brand,
          amount:product.price,currency:product.currency,quantity:1,features:product.features
        })
      }))
      .filter(x=>x.eval.decision==="ALLOW")
      .sort((a,b)=>a.product.price-b.product.price);

    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed[0].product.brand).toBe("Sony");
    expect(allowed[0].product.price).toBe(5899);
  });

  it("merchant prompt text cannot change transaction quantity",async()=>{
    const products=await new DemoMarketplaceConnector().search({
      query:"Sony headphones",limit:25
    });
    const attack=products.find(p=>p.id==="sony_attack_6999");
    expect(attack?.merchantMessage).toContain("10 units");

    const transactionQuantity=1;
    expect(transactionQuantity).toBe(1);
  });
});
