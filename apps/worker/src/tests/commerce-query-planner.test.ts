import {describe,it,expect} from "vitest";
import {planCommerceSearchQuery} from "../commerce/query-planner";

describe("commerce discovery planner",()=>{
  it("removes purchase-control language but keeps product intent",()=>{
    expect(planCommerceSearchQuery("Find me Sony wireless ANC headphones. Buy automatically if allowed."))
      .toBe("Sony wireless ANC headphones");
  });

  it("removes budget phrasing that should be enforced by IntentLock, not search text",()=>{
    expect(planCommerceSearchQuery("Find Bose headphones under $80 and buy automatically"))
      .toBe("Bose headphones");
  });

  it("preserves model numbers",()=>{
    expect(planCommerceSearchQuery("Find Sony WH-1000XM5 headphones"))
      .toContain("WH-1000XM5");
  });

  it("never needs wallet policy as an input",()=>{
    const query=planCommerceSearchQuery("JBL Bluetooth headphones");
    expect(query).toBe("JBL Bluetooth headphones");
  });
});
