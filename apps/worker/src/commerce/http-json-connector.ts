import type {
  CommerceConnector,
  CommerceConnectorInfo,
  CommerceProduct,
  CommerceSearchQuery
} from "./types";

/**
 * Optional real-commerce bridge.
 *
 * Set COMMERCE_CATALOG_URL to any HTTPS endpoint returning either:
 *   { "products": CommerceProduct[] }
 * or
 *   CommerceProduct[]
 *
 * This gives IntentLock a real merchant/catalog integration surface without
 * hard-coding one marketplace or pretending Amazon/IndiaMART credentials exist.
 */
export class HttpJsonCommerceConnector implements CommerceConnector {
  constructor(private readonly endpoint: string) {}

  info(): CommerceConnectorInfo {
    return {
      id: "http-json",
      name: "External Commerce Feed",
      kind: "HTTP_JSON",
      enabled: Boolean(this.endpoint),
      description:
        "Optional live HTTPS product-feed adapter configured by COMMERCE_CATALOG_URL."
    };
  }

  async search(query: CommerceSearchQuery): Promise<CommerceProduct[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set("q", query.query);
    if (query.category) url.searchParams.set("category", query.category);
    if (query.maxPrice) url.searchParams.set("maxPrice", String(query.maxPrice));
    if (query.brands?.length) url.searchParams.set("brands", query.brands.join(","));
    if (query.requiredFeatures?.length)
      url.searchParams.set("features", query.requiredFeatures.join(","));

    const response = await fetch(url.toString(), {
      headers: {"accept":"application/json"}
    });

    if (!response.ok) {
      throw new Error(`EXTERNAL_COMMERCE_FEED_${response.status}`);
    }

    const body:any = await response.json();
    const raw = Array.isArray(body) ? body : body.products;

    if (!Array.isArray(raw)) throw new Error("INVALID_COMMERCE_FEED_RESPONSE");

    return raw
      .map(normalizeProduct)
      .filter(Boolean)
      .slice(0, Math.max(1, Math.min(query.limit ?? 10, 25))) as CommerceProduct[];
  }

  async getProduct(id: string): Promise<CommerceProduct | null> {
    const results = await this.search({query:id, limit:25});
    return results.find(x => x.id === id) ?? null;
  }
}

function normalizeProduct(raw:any):CommerceProduct|null {
  if (!raw || !raw.id || !raw.title || !raw.brand || !raw.category) return null;

  const price=Number(raw.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    id:String(raw.id),
    title:String(raw.title),
    brand:String(raw.brand),
    category:String(raw.category),
    merchant:String(raw.merchant ?? "External Merchant"),
    price,
    currency:String(raw.currency ?? "INR").toUpperCase(),
    quantityAvailable:Number(raw.quantityAvailable ?? 1),
    features:Array.isArray(raw.features) ? raw.features.map(String) : [],
    productUrl:raw.productUrl ? String(raw.productUrl) : undefined,
    imageUrl:raw.imageUrl ? String(raw.imageUrl) : undefined,
    merchantMessage:raw.merchantMessage ? String(raw.merchantMessage) : undefined
  };
}
