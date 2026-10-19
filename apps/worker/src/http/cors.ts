/**
 * Global browser preflight contract. Keep this dependency-free so it can be
 * validated by Node/Vitest without importing Cloudflare's Worker runtime.
 */
export const CORS_ALLOWED_HEADERS = "content-type,x-razorpay-signature,x-intentlock-ops-token";

export function globalPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": CORS_ALLOWED_HEADERS,
      "access-control-allow-methods": "GET,POST,OPTIONS"
    }
  });
}
