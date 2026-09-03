import {demoCatalog} from "./demo-catalog";
import type {
  CommerceConnector,
  CommerceConnectorInfo,
  CommerceProduct,
  CommerceSearchQuery
} from "./types";

const norm=(v:string)=>v.trim().toLowerCase();

export class DemoMarketplaceConnector implements CommerceConnector {
  info(): CommerceConnectorInfo {
    return {
      id: "demo-marketplace",
      name: "IntentLock Demo Marketplace",
      kind: "DEMO",
      enabled: true,
      description:
        "Deterministic hackathon catalog containing compliant, step-up, blocked, and adversarial merchant listings."
    };
  }

  async search(query: CommerceSearchQuery): Promise<CommerceProduct[]> {
    const words = norm(query.query)
      .split(/\s+/)
      .filter(Boolean);

    const requiredFeatures = (query.requiredFeatures ?? []).map(norm);
    const brands = (query.brands ?? []).map(norm);

    const scored = demoCatalog.map(product => {
      let score = 0;
      const haystack = norm([
        product.title,
        product.brand,
        product.category,
        product.merchant,
        ...product.features
      ].join(" "));

      for (const word of words) if (haystack.includes(word)) score += 2;
      if (query.category && norm(product.category) === norm(query.category)) score += 4;
      if (brands.length && brands.includes(norm(product.brand))) score += 4;

      for (const feature of requiredFeatures) {
        if (product.features.map(norm).includes(feature)) score += 2;
      }

      // Price is a ranking hint only. IntentLock policy remains authoritative.
      if (query.maxPrice && product.price <= query.maxPrice) score += 1;

      return {product, score};
    });

    return scored
      .filter(x => x.score > 0 || !query.query.trim())
      .sort((a,b) => b.score - a.score || a.product.price - b.product.price)
      .slice(0, Math.max(1, Math.min(query.limit ?? 10, 25)))
      .map(x => x.product);
  }

  async getProduct(id: string) {
    return demoCatalog.find(p => p.id === id) ?? null;
  }
}
