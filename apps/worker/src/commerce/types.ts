export type CommerceProduct = {
  id: string;
  title: string;
  brand: string;
  category: string;
  merchant: string;
  price: number;
  currency: string;
  quantityAvailable: number;
  features: string[];
  productUrl?: string;
  imageUrl?: string;

  // Merchant-controlled text. This is intentionally kept separate from
  // trusted product facts so it cannot become authorization authority.
  merchantMessage?: string;
};

export type CommerceSearchQuery = {
  query: string;
  category?: string;
  brands?: string[];
  maxPrice?: number;
  requiredFeatures?: string[];
  limit?: number;
};

export type CommerceConnectorInfo = {
  id: string;
  name: string;
  kind: "DEMO" | "HTTP_JSON" | "AMAZON_CREATORS" | "INDIAMART";
  enabled: boolean;
  description: string;
};

export interface CommerceConnector {
  info(): CommerceConnectorInfo;
  search(query: CommerceSearchQuery): Promise<CommerceProduct[]>;
  getProduct(id: string): Promise<CommerceProduct | null>;
}
