import type {PaymentAuthorizationContext} from "../payments/context-types";

export type CommerceProductSource = {
  provider:string;
  marketplaceId?:string;
  listingId?:string;
  payeeId?:string;
  payeeType?:"EBAY_SELLER"|"SHOPIFY_STORE"|"MARKETPLACE_MERCHANT"|"EXTERNAL_PAYEE";
};

export type CommerceProduct = {
  id:string;
  title:string;
  brand:string;
  category:string;
  merchant:string;
  merchantCountry?:string;
  price:number;
  currency:string;
  quantityAvailable:number;
  features:string[];
  productUrl?:string;
  imageUrl?:string;
  merchantMessage?:string;
  source?:CommerceProductSource;

  // Added only after IntentLock has normalized cross-currency/country facts.
  // Connectors should not trust or populate this field themselves.
  authorizationContext?:PaymentAuthorizationContext;
};

export type CommerceSearchQuery = {
  query:string;
  category?:string;
  brands?:string[];
  maxPrice?:number;
  requiredFeatures?:string[];
  limit?:number;
};

export type CommerceConnectorInfo = {
  id:string;
  name:string;
  kind:"DEMO"|"PAYPAL_DEMO"|"EBAY"|"HTTP_JSON"|"SHOPIFY"|"AMAZON_CREATORS"|"INDIAMART";
  enabled:boolean;
  description:string;
};

export interface CommerceConnector {
  info():CommerceConnectorInfo;
  search(query:CommerceSearchQuery):Promise<CommerceProduct[]>;
  getProduct(id:string):Promise<CommerceProduct|null>;
}
