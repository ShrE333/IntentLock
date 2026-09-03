import type {CommerceConnector, CommerceConnectorInfo} from "./types";
import {DemoMarketplaceConnector} from "./demo-connector";
import {HttpJsonCommerceConnector} from "./http-json-connector";

export type CommerceEnv = {
  COMMERCE_CATALOG_URL?: string;
};

export function getCommerceConnectors(env: CommerceEnv): CommerceConnector[] {
  const connectors: CommerceConnector[] = [
    new DemoMarketplaceConnector()
  ];

  if (env.COMMERCE_CATALOG_URL) {
    connectors.push(new HttpJsonCommerceConnector(env.COMMERCE_CATALOG_URL));
  }

  return connectors;
}

export function connectorStatus(env: CommerceEnv): CommerceConnectorInfo[] {
  const active = getCommerceConnectors(env).map(c => c.info());

  return [
    ...active,
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
