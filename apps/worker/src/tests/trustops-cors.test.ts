import {describe,it,expect} from "vitest";
import {CORS_ALLOWED_HEADERS,globalPreflightResponse} from "../http/cors";

describe("V11.4.1 TrustOps browser preflight",()=>{
  it("allows protected TrustOps requests through the global OPTIONS response",()=>{
    const response=globalPreflightResponse();
    const allowed=String(response.headers.get("access-control-allow-headers")??"").toLowerCase();
    const methods=String(response.headers.get("access-control-allow-methods")??"");

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(allowed).toContain("content-type");
    expect(allowed).toContain("x-intentlock-ops-token");
    expect(methods).toContain("POST");
    expect(CORS_ALLOWED_HEADERS).toBe(allowed);
  });
});
