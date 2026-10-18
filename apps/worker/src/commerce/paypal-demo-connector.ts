import {paypalDemoCatalog} from "./paypal-demo-catalog";
import type {CommerceConnector,CommerceConnectorInfo,CommerceProduct,CommerceSearchQuery} from "./types";

const norm=(v:string)=>v.trim().toLowerCase();

export class PayPalDemoMarketplaceConnector implements CommerceConnector{
  info():CommerceConnectorInfo{
    return {
      id:"paypal-demo-marketplace",
      name:"PayPal Sandbox Marketplace",
      kind:"PAYPAL_DEMO",
      enabled:true,
      description:"Deterministic multi-currency catalog for PayPal capability, FX-bound authorization and red-team demos."
    };
  }

  async search(query:CommerceSearchQuery):Promise<CommerceProduct[]>{
    const words=norm(query.query).split(/\s+/).filter(Boolean);
    const required=(query.requiredFeatures??[]).map(norm);
    const brands=(query.brands??[]).map(norm);

    return paypalDemoCatalog
      .map(product=>{
        let score=0;
        const features=product.features.map(norm);
        const haystack=norm([product.title,product.brand,product.category,product.merchant,...product.features].join(" "));
        for(const word of words) if(haystack.includes(word)) score+=2;
        if(query.category&&norm(product.category)===norm(query.category)) score+=4;
        if(brands.length&&brands.includes(norm(product.brand))) score+=4;
        for(const feature of required) if(features.includes(feature)) score+=2;
        if(query.maxPrice&&product.price<=query.maxPrice) score+=1;
        return {product,score};
      })
      .filter(x=>x.score>0||!query.query.trim())
      .sort((a,b)=>b.score-a.score||a.product.price-b.product.price)
      .slice(0,Math.max(1,Math.min(query.limit??10,25)))
      .map(x=>x.product);
  }

  async getProduct(id:string){
    return paypalDemoCatalog.find(p=>p.id===id)??null;
  }
}
