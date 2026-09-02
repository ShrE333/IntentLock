import { z } from "zod";
import { evaluatePurchase } from "../policy/engine";
import type {
  IntentContract,
  PurchaseProposal
} from "../types/contracts";

const ApprovalPayloadSchema = z.object({
  v: z.literal(1),
  approvalId: z.string().uuid(),
  intentId: z.string().min(1),
  quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
  productId: z.string().min(1),
  amount: z.number().nonnegative(),
  quantity: z.number().int().positive(),
  currency: z.literal("INR"),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  nonce: z.string().uuid()
});

export type ApprovalPayload = z.infer<typeof ApprovalPayloadSchema>;

export type ApprovalVerification =
  | {
      allowed: true;
      code: "APPROVAL_VALID";
      payload: ApprovalPayload;
      currentQuoteHash: string;
      violations: [];
    }
  | {
      allowed: false;
      code:
        | "INVALID_TOKEN"
        | "INVALID_SIGNATURE"
        | "APPROVAL_EXPIRED"
        | "INTENT_MISMATCH"
        | "QUOTE_CHANGED"
        | "POLICY_BLOCKED";
      payload?: ApprovalPayload;
      currentQuoteHash?: string;
      violations: string[];
    };

function normalizeFeature(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalCart(
  intent: IntentContract,
  proposal: PurchaseProposal
): string {
  const snapshot = {
    intentId: intent.id,
    productId: proposal.productId,
    brand: proposal.brand.trim().toLowerCase(),
    category: proposal.category.trim().toLowerCase(),
    quantity: proposal.quantity,
    unitPrice: proposal.unitPrice,
    totalAmount: proposal.quantity * proposal.unitPrice,
    currency: proposal.currency,
    features: [...proposal.features]
      .map(normalizeFeature)
      .sort()
  };

  // Property insertion order is deliberately fixed above.
  return JSON.stringify(snapshot);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (value.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeText(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encodeText(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 24) {
    throw new Error("APPROVAL_SIGNING_SECRET must be at least 24 characters.");
  }

  return crypto.subtle.importKey(
    "raw",
    encodeText(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign", "verify"]
  );
}

async function sign(encodedPayload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encodeText(encodedPayload)
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifySignature(
  encodedPayload: string,
  encodedSignature: string,
  secret: string
): Promise<boolean> {
  try {
    const key = await importHmacKey(secret);
    return crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(encodedSignature),
      encodeText(encodedPayload)
    );
  } catch {
    return false;
  }
}

export async function computeQuoteHash(
  intent: IntentContract,
  proposal: PurchaseProposal
): Promise<string> {
  return sha256Hex(canonicalCart(intent, proposal));
}

export async function createApprovalToken(
  intent: IntentContract,
  proposal: PurchaseProposal,
  secret: string,
  ttlSeconds = 300,
  now = new Date()
): Promise<{
  token: string;
  payload: ApprovalPayload;
}> {
  const policy = evaluatePurchase(intent, proposal, false, now);

  if (
    policy.code !== "REQUIRES_APPROVAL" &&
    policy.code !== "ALLOW"
  ) {
    throw new Error(
      `Cannot create approval for policy-invalid transaction: ${policy.violations.join(",")}`
    );
  }

  const quoteHash = await computeQuoteHash(intent, proposal);
  const issuedAt = now.toISOString();

  const maxExpiry = Math.min(
    now.getTime() + ttlSeconds * 1000,
    new Date(intent.expiresAt).getTime(),
    new Date(proposal.quoteExpiresAt).getTime()
  );

  const payload = ApprovalPayloadSchema.parse({
    v: 1,
    approvalId: crypto.randomUUID(),
    intentId: intent.id,
    quoteHash,
    productId: proposal.productId,
    amount: policy.totalAmount,
    quantity: proposal.quantity,
    currency: proposal.currency,
    issuedAt,
    expiresAt: new Date(maxExpiry).toISOString(),
    nonce: crypto.randomUUID()
  });

  const encodedPayload = bytesToBase64Url(
    encodeText(JSON.stringify(payload))
  );
  const signature = await sign(encodedPayload, secret);

  return {
    token: `${encodedPayload}.${signature}`,
    payload
  };
}

export async function verifyApprovalToken(
  token: string,
  intent: IntentContract,
  currentProposal: PurchaseProposal,
  secret: string,
  now = new Date()
): Promise<ApprovalVerification> {
  const parts = token.split(".");

  if (parts.length !== 2) {
    return {
      allowed: false,
      code: "INVALID_TOKEN",
      violations: ["INVALID_TOKEN"]
    };
  }

  const [encodedPayload, encodedSignature] = parts;

  const signatureValid = await verifySignature(
    encodedPayload,
    encodedSignature,
    secret
  );

  if (!signatureValid) {
    return {
      allowed: false,
      code: "INVALID_SIGNATURE",
      violations: ["INVALID_SIGNATURE"]
    };
  }

  let payload: ApprovalPayload;
  try {
    payload = ApprovalPayloadSchema.parse(
      JSON.parse(decodeText(base64UrlToBytes(encodedPayload)))
    );
  } catch {
    return {
      allowed: false,
      code: "INVALID_TOKEN",
      violations: ["INVALID_TOKEN"]
    };
  }

  if (new Date(payload.expiresAt) <= now) {
    return {
      allowed: false,
      code: "APPROVAL_EXPIRED",
      payload,
      violations: ["APPROVAL_EXPIRED"]
    };
  }

  if (payload.intentId !== intent.id) {
    return {
      allowed: false,
      code: "INTENT_MISMATCH",
      payload,
      violations: ["INTENT_MISMATCH"]
    };
  }

  const currentQuoteHash = await computeQuoteHash(intent, currentProposal);

  if (currentQuoteHash !== payload.quoteHash) {
    return {
      allowed: false,
      code: "QUOTE_CHANGED",
      payload,
      currentQuoteHash,
      violations: ["QUOTE_CHANGED"]
    };
  }

  const policy = evaluatePurchase(intent, currentProposal, true, now);

  if (!policy.allowed) {
    return {
      allowed: false,
      code: "POLICY_BLOCKED",
      payload,
      currentQuoteHash,
      violations: policy.violations.length
        ? policy.violations
        : [policy.code]
    };
  }

  return {
    allowed: true,
    code: "APPROVAL_VALID",
    payload,
    currentQuoteHash,
    violations: []
  };
}
