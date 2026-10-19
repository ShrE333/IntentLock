import {describe,it,expect} from "vitest";
import {buildPayeeLockBinding,assertPayeeIdentityStable,publicPayeeLockConfig} from "../commerce/payee-lock";
import {canonicalWalletTransaction} from "../wallets/crypto";
import type {CommerceProduct} from "../commerce/types";

const product=(payeeId="seller-a"):CommerceProduct=>({
  id:"item-1",title:"Sony Headphones",brand:"Sony",category:"electronics",
  merchant:"Seller A",merchantCountry:"US",price:49,currency:"USD",quantityAvailable:1,
  features:["wireless","ANC"],
  source:{provider:"ebay",listingId:"item-1",payeeId,payeeType:"EBAY_SELLER"}
});

describe("PayeeLock",()=>{
  it("creates a stable structured payee fingerprint",async()=>{
    const a=await buildPayeeLockBinding({},product());
    const b=await buildPayeeLockBinding({},product());
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.provider).toBe("ebay");
    expect(a.payeeId).toBe("seller-a");
  });

  it("detects seller substitution before execution",async()=>{
    const bound=await buildPayeeLockBinding({},product("seller-a"));
    await expect(assertPayeeIdentityStable({},bound,product("attacker-seller")))
      .rejects.toThrow("PAYEE_IDENTITY_CHANGED_REAUTHORIZE");
  });

  it("allows the same payee to be revalidated",async()=>{
    const bound=await buildPayeeLockBinding({},product("seller-a"));
    const result=await assertPayeeIdentityStable({},bound,product("seller-a"));
    expect(result.legacy).toBe(false);
    expect(result.binding?.fingerprint).toBe(bound.fingerprint);
  });

  it("fails closed in enforce mode when a payee is not trusted",async()=>{
    const env={
      PAYEELOCK_MODE:"enforce",
      PAYEELOCK_TRUSTED_PAYEES_JSON:JSON.stringify([{provider:"ebay",payeeId:"trusted-seller",merchantCountry:"US"}])
    };
    await expect(buildPayeeLockBinding(env,product("seller-a"))).rejects.toThrow("PAYEE_NOT_TRUSTED");
  });

  it("recognizes a configured trusted payee",async()=>{
    const env={
      PAYEELOCK_MODE:"enforce",
      PAYEELOCK_TRUSTED_PAYEES_JSON:JSON.stringify([{provider:"ebay",payeeId:"seller-a",merchantCountry:"US",label:"Approved seller"}])
    };
    const binding=await buildPayeeLockBinding(env,product("seller-a"));
    expect(binding.trustStatus).toBe("TRUSTED");
    expect(binding.trustedLabel).toBe("Approved seller");
    expect(publicPayeeLockConfig(env).trustedPayeeCount).toBe(1);
  });

  it("preserves legacy quote serialization when no payee binding exists",()=>{
    const raw=canonicalWalletTransaction({
      productName:"Sony",category:"electronics",brand:"Sony",amount:49,currency:"USD",quantity:1,features:["ANC"]
    });
    expect(raw).not.toContain("payeeFingerprint");
    expect(raw).not.toContain("payeeProvider");
  });
});
