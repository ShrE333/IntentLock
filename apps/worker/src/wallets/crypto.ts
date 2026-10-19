import type {WalletTransaction} from "./types";

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_BASE64URL");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

function decodeCanonicalBase64Url(value: string) {
  const decoded = decodeBase64Url(value);
  if (base64Url(decoded) !== value) throw new Error("NON_CANONICAL_BASE64URL");
  return decoded;
}

export function canonicalWalletTransaction(tx: WalletTransaction) {
  const core:Record<string,unknown>={
    amount: tx.amount,
    brand: tx.brand.trim(),
    category: tx.category.trim(),
    currency: tx.currency.toUpperCase(),
    features: [...tx.features].map(v => v.trim()).sort((a,b)=>a.localeCompare(b)),
    productName: tx.productName?.trim() ?? "",
    quantity: tx.quantity,

    // Optional cross-currency/cross-border facts. Including them here means a
    // one-time authorization cannot be replayed against another FX quote,
    // merchant country, presentment currency, or buyer jurisdiction.
    presentmentAmount: tx.presentmentAmount ?? null,
    presentmentCurrency: tx.presentmentCurrency?.toUpperCase() ?? null,
    buyerCountry: tx.buyerCountry?.toUpperCase() ?? null,
    merchantCountry: tx.merchantCountry?.toUpperCase() ?? null,
    fxQuoteId: tx.fxQuoteId ?? null,
    fxRate: tx.fxRate ?? null,
    fxSource: tx.fxSource ?? null,
    fxQuotedAt: tx.fxQuotedAt ?? null,
    fxExpiresAt: tx.fxExpiresAt ?? null
  };

  // Important compatibility rule: do not add these keys to old transactions
  // that were authorized before V11.2, otherwise their historical quote hash
  // would change merely because the software was upgraded.
  if(tx.payeeProvider!==undefined||tx.payeeFingerprint!==undefined){
    core.payeeProvider=tx.payeeProvider??null;
    core.payeeFingerprint=tx.payeeFingerprint??null;
  }

  return JSON.stringify(core);
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC", hash:"SHA-256"},false,["sign","verify"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return new Uint8Array(sig);
}

export type StepUpTokenPayload = {
  type: "INTENTLOCK_STEP_UP_ONCE";
  authorizationId: string;
  requestId: string;
  walletId: string;
  quoteHash: string;
  amount: number;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
};

export async function signStepUpToken(secret: string,payload: StepUpTokenPayload) {
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  const signature = base64Url(await hmac(secret, body));
  return `${body}.${signature}`;
}

export async function verifyStepUpToken(secret: string,token: string): Promise<{valid:boolean; payload?:StepUpTokenPayload; reason?:string}> {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra) return {valid:false, reason:"MALFORMED_TOKEN"};

  let actual: Uint8Array;
  try {
    decodeCanonicalBase64Url(body);
    actual = decodeCanonicalBase64Url(sig);
  } catch {
    return {valid:false, reason:"NON_CANONICAL_TOKEN"};
  }

  const expected = await hmac(secret, body);
  if (expected.length !== actual.length) return {valid:false, reason:"INVALID_SIGNATURE"};

  let diff = 0;
  for (let i=0;i<expected.length;i++) diff |= expected[i] ^ actual[i];
  if (diff !== 0) return {valid:false, reason:"INVALID_SIGNATURE"};

  try {
    const decoded = new TextDecoder().decode(decodeCanonicalBase64Url(body));
    const payload = JSON.parse(decoded) as StepUpTokenPayload;
    if (payload.type !== "INTENTLOCK_STEP_UP_ONCE") return {valid:false, reason:"INVALID_TOKEN_TYPE"};
    if (new Date(payload.expiresAt).getTime() <= Date.now()) return {valid:false, reason:"TOKEN_EXPIRED"};
    return {valid:true, payload};
  } catch {
    return {valid:false, reason:"INVALID_PAYLOAD"};
  }
}
