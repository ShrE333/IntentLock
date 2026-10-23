import type {CommerceConnector,CommerceConnectorInfo} from "./types";
import {DemoMarketplaceConnector} from "./demo-connector";
import {PayPalDemoMarketplaceConnector} from "./paypal-demo-connector";
import {EbayBrowseConnector} from "./ebay-connector";
import {HttpJsonCommerceConnector} from "./http-json-connector";
import {ShopifyStorefrontConnector} from "./shopify-connector";
import {ShopifyGlobalCatalogConnector,shopifyMcpEnabled,type ShopifyMcpEnv} from './shopify-mcp';

export type CommerceEnv=ShopifyMcpEnv & {
  COMMERCE_CATALOG_URL?:string;
  SHOPIFY_STORE_DOMAIN?:string;
  SHOPIFY_STOREFRONT_PUBLIC_TOKEN?:string;
  SHOPIFY_STOREFRONT_PRIVATE_TOKEN?:string;
  SHOPIFY_STOREFRONT_API_VERSION?:string;

  EBAY_CLIENT_ID?:string;
  EBAY_CLIENT_SECRET?:string;
  EBAY_ENV?:string;
  EBAY_MARKETPLACE_ID?:string;
  EBAY_ENDUSER_COUNTRY?:string;
  EBAY_ENDUSER_POSTAL_CODE?:string;
};

export function getCommerceConnectors(env:CommerceEnv):CommerceConnector[]{
  const connectors:CommerceConnector[]=[
    new PayPalDemoMarketplaceConnector(),
    new DemoMarketplaceConnector()
  ];
  if(shopifyMcpEnabled(env))connectors.push(new ShopifyGlobalCatalogConnector(env));

  if(env.EBAY_CLIENT_ID&&env.EBAY_CLIENT_SECRET){
    connectors.push(new EbayBrowseConnector({
      clientId:env.EBAY_CLIENT_ID,
      clientSecret:env.EBAY_CLIENT_SECRET,
      environment:env.EBAY_ENV||"sandbox",
      marketplaceId:env.EBAY_MARKETPLACE_ID||"EBAY_US",
      endUserCountry:env.EBAY_ENDUSER_COUNTRY,
      endUserPostalCode:env.EBAY_ENDUSER_POSTAL_CODE
    }));
  }

  if(env.SHOPIFY_STORE_DOMAIN&&(env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN||env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN)){
    connectors.push(new ShopifyStorefrontConnector({
      storeDomain:env.SHOPIFY_STORE_DOMAIN,
      privateToken:env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
      publicToken:env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN,
      apiVersion:env.SHOPIFY_STOREFRONT_API_VERSION||"2026-07"
    }));
  }

  if(env.COMMERCE_CATALOG_URL)
    connectors.push(new HttpJsonCommerceConnector(env.COMMERCE_CATALOG_URL));

  return connectors;
}

export function connectorStatus(env:CommerceEnv):CommerceConnectorInfo[]{
  const active=getCommerceConnectors(env).map(c=>c.info());
  const ebayConfigured=active.some(x=>x.id==="ebay-browse");
  const shopifyConfigured=active.some(x=>x.id==="shopify-storefront");

  return [
    ...active,
    ...(!shopifyMcpEnabled(env)?[{id:'shopify-global-catalog',name:'Shopify Global Catalog MCP',kind:'SHOPIFY' as const,enabled:false,description:'Read-only live UCP discovery. Disabled by default; no merchant checkout.'}]:[]),
    ...(!ebayConfigured?[{
      id:"ebay-browse",name:"eBay Browse",kind:"EBAY" as const,
      enabled:false,description:"Live eBay Browse adapter. Configure EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to enable it."
    }]:[]),
    ...(!shopifyConfigured?[{
      id:"shopify-storefront",name:"Shopify Storefront",kind:"SHOPIFY" as const,
      enabled:false,description:"Optional live Storefront adapter. IntentLock no longer depends on it."
    }]:[]),
    {
      id:"amazon-creators",name:"Amazon Creators API",kind:"AMAZON_CREATORS" as const,
      enabled:false,description:"Adapter slot reserved until valid API access is configured."
    },
    {
      id:"indiamart",name:"IndiaMART",kind:"INDIAMART" as const,
      enabled:false,description:"Adapter slot reserved until a supported catalog integration is configured."
    }
  ];
}
