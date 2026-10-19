import {describe,it,expect} from "vitest";
import {buildOrchestratorEnv} from "../sessions/routes";

describe("session runtime environment",()=>{
  it("preserves live connector and PayeeLock configuration",()=>{
    const env:any={
      DATABASE_URL:"postgresql://example",
      EBAY_CLIENT_ID:"client",
      EBAY_CLIENT_SECRET:"secret",
      EBAY_ENV:"production",
      EBAY_MARKETPLACE_ID:"EBAY_US",
      PAYEELOCK_MODE:"enforce",
      PAYEELOCK_TRUSTED_PAYEES_JSON:'[{"provider":"ebay","payeeId":"seller"}]',
      FX_PROVIDER:"static"
    };
    const built:any=buildOrchestratorEnv(env);
    expect(built.EBAY_CLIENT_ID).toBe("client");
    expect(built.EBAY_CLIENT_SECRET).toBe("secret");
    expect(built.EBAY_MARKETPLACE_ID).toBe("EBAY_US");
    expect(built.PAYEELOCK_MODE).toBe("enforce");
    expect(built.FX_PROVIDER).toBe("static");
  });
});
