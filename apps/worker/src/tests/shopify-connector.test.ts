import {describe,it,expect} from "vitest";
import type {CommerceProduct} from "../commerce/types";
import {
  normalizeShopifyDomain,
  normalizeShopifyProduct,
  rankShopifyProducts
} from "../commerce/shopify-connector";

describe("V10.7 Shopify connector",()=>{
  it("normalizes Shopify store domains",()=>{
    expect(
      normalizeShopifyDomain("https://intentlock-demo.myshopify.com/")
    ).toBe("intentlock-demo.myshopify.com");
  });

  it("maps a Shopify product variant into IntentLock commerce facts",()=>{
    const product=normalizeShopifyProduct({
      id:"gid://shopify/Product/1",
      handle:"sony-wh-ch720n",
      title:"Sony WH-CH720N Wireless ANC Headphones",
      description:"Merchant supplied description",
      vendor:"Sony",
      productType:"electronics",
      tags:["wireless","ANC"],
      onlineStoreUrl:null,
      featuredImage:{url:"https://cdn.example/image.jpg"},
      variants:{
        nodes:[{
          id:"gid://shopify/ProductVariant/11",
          title:"Default",
          availableForSale:true,
          price:{amount:"5899.00",currencyCode:"INR"},
          selectedOptions:[]
        }]
      }
    },"intentlock-demo.myshopify.com","IntentLock Demo Store");

    expect(product?.id).toBe("gid://shopify/ProductVariant/11");
    expect(product?.price).toBe(5899);
    expect(product?.brand).toBe("Sony");
    expect(product?.category).toBe("electronics");
    expect(product?.features).toContain("ANC");
    expect(product?.merchantMessage).toBe("Merchant supplied description");
  });

  it("ranks a relevant live product above unrelated products",()=>{
    const products:CommerceProduct[]=[
      {
        id:"sony",
        title:"Sony Wireless ANC Headphones",
        brand:"Sony",
        category:"electronics",
        merchant:"Shopify Demo",
        price:5899,
        currency:"INR",
        quantityAvailable:1,
        features:["wireless","ANC"]
      },
      {
        id:"mug",
        title:"Ceramic Coffee Mug",
        brand:"HomeCo",
        category:"home",
        merchant:"Shopify Demo",
        price:499,
        currency:"INR",
        quantityAvailable:1,
        features:["ceramic"]
      }
    ];

    const ranked=rankShopifyProducts(products,{
      query:"Find Sony wireless ANC headphones under ₹7000",
      category:"electronics",
      brands:["Sony","Bose"],
      maxPrice:7000,
      requiredFeatures:["wireless","ANC"],
      limit:10
    });

    expect(ranked[0]?.id).toBe("sony");
  });

  it("does not make price a hard connector filter",()=>{
    const products:CommerceProduct[]=[
      {
        id:"bose",
        title:"Bose Wireless ANC Headphones",
        brand:"Bose",
        category:"electronics",
        merchant:"Shopify Demo",
        price:7499,
        currency:"INR",
        quantityAvailable:1,
        features:["wireless","ANC"]
      }
    ];

    const ranked=rankShopifyProducts(products,{
      query:"Bose wireless ANC headphones",
      maxPrice:7000,
      requiredFeatures:["wireless","ANC"]
    });

    // IntentLock policy, not the connector, must produce the hard BLOCK.
    expect(ranked).toHaveLength(1);
  });
});
