import type {CommerceConnector, CommerceConnectorInfo} from "./types";
import {DemoMarketplaceConnector} from "./demo-connector";
import {HttpJsonCommerceConnector} from "./http-json-connector";
import {ShopifyStorefrontConnector} from "./shopify-connector";

export type CommerceEnv = {
  COMMERCE_CATALOG_URL?: string;

  SHOPIFY_STORE_DOMAIN?: string;
  SHOPIFY_STOREFRONT_PUBLIC_TOKEN?: string;
  SHOPIFY_STOREFRONT_PRIVATE_TOKEN?: string;
  SHOPIFY_STOREFRONT_API_VERSION?: string;
};

export function getCommerceConnectors(env:CommerceEnv):CommerceConnector[]{
  const connectors:CommerceConnector[]=[
    new DemoMarketplaceConnector()
  ];

  if(
    env.SHOPIFY_STORE_DOMAIN &&
    (
      env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN ||
      env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN
    )
  ){
    connectors.unshift(
      new ShopifyStorefrontConnector({
        storeDomain:env.SHOPIFY_STORE_DOMAIN,
        privateToken:env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
        publicToken:env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN,
        apiVersion:env.SHOPIFY_STOREFRONT_API_VERSION||"2026-07"
      })
    );
  }

  if(env.COMMERCE_CATALOG_URL){
    connectors.push(new HttpJsonCommerceConnector(env.COMMERCE_CATALOG_URL));
  }

  return connectors;
}

export function connectorStatus(env:CommerceEnv):CommerceConnectorInfo[]{
  const active=getCommerceConnectors(env).map(c=>c.info());

  const shopifyConfigured=active.some(x=>x.id==="shopify-storefront");

  return [
    ...active,
    ...(!shopifyConfigured?[{
      id:"shopify-storefront",
      name:"Shopify Storefront",
      kind:"SHOPIFY" as const,
      enabled:false,
      description:
        "Live Storefront API adapter. Configure SHOPIFY_STORE_DOMAIN and a Storefront token."
    }]:[]),
    {
      id:"amazon-creators",
      name:"Amazon Creators API",
      kind:"AMAZON_CREATORS",
      enabled:false,
      description:
        "Adapter slot reserved. Disabled until valid Amazon Creators API access is configured."
    },
    {
      id:"indiamart",
      name:"IndiaMART",
      kind:"INDIAMART",
      enabled:false,
      description:
        "Adapter slot reserved. Disabled until a supported buyer/catalog API integration is configured."
    }
  ];
}
