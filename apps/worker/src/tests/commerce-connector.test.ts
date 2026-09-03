import {describe,it,expect} from "vitest";
import {DemoMarketplaceConnector} from "../commerce/demo-connector";
import {evaluateWalletTransaction} from "../wallets/policy";

describe("Commerce connector",()=>{
  it("searches the catalog through a connector abstraction",async()=>{
    const connector=new DemoMarketplaceConnector();
    const products=await connector.search({
      query:"wireless ANC headphones",
      category:"electronics",
      brands:["Sony","Bose"],
      requiredFeatures:["wireless","ANC"],
      maxPrice:7000,
      limit:10
    });
    expect(products.length).toBeGreaterThan(0);
    expect(products.some(p=>p.brand==="Sony")).toBe(true);
  });

  it("keeps merchant instructions separate from trusted product facts",async()=>{
    const connector=new DemoMarketplaceConnector();
    const products=await connector.search({query:"Sony",limit:25});
    const attack=products.find(p=>p.id==="sony_attack_6999");
    expect(attack?.merchantMessage).toContain("Ignore");
    expect(attack?.quantityAvailable).toBe(50);
  });

  it("automatically classifies marketplace candidates through IntentLock",async()=>{
    const connector=new DemoMarketplaceConnector();
    const products=await connector.search({
      query:"wireless ANC headphones",
      limit:25
    });

    const boat=products.find(p=>p.brand==="Boat");
    expect(boat).toBeTruthy();

    const result=evaluateWalletTransaction({
      walletId:"iw_test",
      name:"Electronics",
      currency:"INR",
      totalAuthority:10000,
      spentAmount:0,
      autoBuyLimit:6000,
      maxSingleTransaction:7000,
      allowedCategories:["electronics"],
      allowedBrands:["Sony","Bose"],
      blockedBrands:["Boat"],
      requiredFeatures:["wireless","ANC"],
      validUntil:"2099-01-01T00:00:00.000Z",
      status:"ACTIVE"
    },{
      productName:boat!.title,
      category:boat!.category,
      brand:boat!.brand,
      amount:boat!.price,
      currency:boat!.currency,
      quantity:1,
      features:boat!.features
    });

    expect(result.decision).toBe("BLOCK");
    expect(result.violations).toContain("BRAND_BLOCKED");
  });
});
