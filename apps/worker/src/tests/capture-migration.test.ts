import {beforeEach,describe,expect,it,vi} from "vitest";

const {neonMock}=vi.hoisted(()=>({neonMock:vi.fn()}));
vi.mock("@neondatabase/serverless",()=>({neon:neonMock}));
vi.mock("agents",()=>({routeAgentRequest:vi.fn().mockResolvedValue(null)}));
vi.mock("../agent/purchase-agent",()=>({PurchaseAgent:class {}}));
import worker from "../index";

describe("removed temporary capture migration administration",()=>{
  beforeEach(()=>{neonMock.mockClear();});
  it.each([
    ["v11-0-2",""],["v11-0-3",""],
    ["v11-0-2","SELECT 1"],["v11-0-3","SELECT 1"],
    ["v11-0-2",JSON.stringify({sql:"SELECT 1"})],
    ["v11-0-3",JSON.stringify({sql:"SELECT 1"})]
  ])("returns 404 without database access for %s with body %j",async(version,body)=>{
    const response=await worker.fetch(new Request(
      `https://worker.test/internal/admin/apply-${version}-capture-fix`,
      {method:"POST",body}
    ),{} as Parameters<typeof worker.fetch>[1]);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({error:"NOT_FOUND"});
    expect(neonMock).not.toHaveBeenCalled();
  });
});
