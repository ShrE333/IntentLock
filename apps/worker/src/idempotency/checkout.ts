import type { IdempotencyStore } from "./store";
import type {
  IntentContract,
  PurchaseProposal
} from "../types/contracts";
import { computeQuoteHash } from "../security/approval";

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encodeText(value)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildCheckoutIdempotencyKey(
  intent: IntentContract,
  proposal: PurchaseProposal
): Promise<string> {
  const quoteHash = await computeQuoteHash(intent, proposal);

  const digest = await sha256Hex(
    [
      "checkout",
      intent.id,
      proposal.productId,
      proposal.quantity,
      proposal.currency,
      quoteHash
    ].join("|")
  );

  return `intentlock:checkout:${digest}`;
}

export async function claimCheckout(
  store: IdempotencyStore,
  intent: IntentContract,
  proposal: PurchaseProposal,
  ttlSeconds = 900
) {
  const key = await buildCheckoutIdempotencyKey(
    intent,
    proposal
  );

  const requestId = crypto.randomUUID();

  const claim = await store.claim(
    key,
    JSON.stringify({
      requestId,
      intentId: intent.id,
      productId: proposal.productId,
      claimedAt: new Date().toISOString()
    }),
    ttlSeconds
  );

  return {
    ...claim,
    requestId
  };
}
