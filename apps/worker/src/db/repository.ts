import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { IntentContract } from "../types/contracts";
import type { ApprovalPayload } from "../security/approval";

export async function persistIntent(
  sql: NeonQueryFunction<false, false>,
  intent: IntentContract
): Promise<void> {
  await sql`
    INSERT INTO intents (
      id,
      category,
      max_amount,
      currency,
      max_quantity,
      blocked_brands,
      required_features,
      preferred_features,
      requires_approval,
      expires_at
    )
    VALUES (
      ${intent.id},
      ${intent.category},
      ${intent.maxAmount},
      ${intent.currency},
      ${intent.maxQuantity},
      ${JSON.stringify(intent.blockedBrands)}::jsonb,
      ${JSON.stringify(intent.requiredFeatures)}::jsonb,
      ${JSON.stringify(intent.preferredFeatures)}::jsonb,
      ${intent.requiresApproval},
      ${intent.expiresAt}::timestamptz
    )
    ON CONFLICT (id) DO UPDATE SET
      category = EXCLUDED.category,
      max_amount = EXCLUDED.max_amount,
      currency = EXCLUDED.currency,
      max_quantity = EXCLUDED.max_quantity,
      blocked_brands = EXCLUDED.blocked_brands,
      required_features = EXCLUDED.required_features,
      preferred_features = EXCLUDED.preferred_features,
      requires_approval = EXCLUDED.requires_approval,
      expires_at = EXCLUDED.expires_at
  `;
}

export async function persistApproval(
  sql: NeonQueryFunction<false, false>,
  payload: ApprovalPayload,
  tokenHash: string
): Promise<void> {
  await sql`
    INSERT INTO approvals (
      id,
      intent_id,
      quote_hash,
      token_hash,
      product_id,
      amount,
      quantity,
      currency,
      issued_at,
      expires_at,
      nonce
    )
    VALUES (
      ${payload.approvalId}::uuid,
      ${payload.intentId},
      ${payload.quoteHash},
      ${tokenHash},
      ${payload.productId},
      ${payload.amount},
      ${payload.quantity},
      ${payload.currency},
      ${payload.issuedAt}::timestamptz,
      ${payload.expiresAt}::timestamptz,
      ${payload.nonce}::uuid
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function persistBlockedTransaction(
  sql: NeonQueryFunction<false, false>,
  input: {
    intentId: string;
    idempotencyKey: string;
    amount: number;
    currency: "INR";
  }
) {
  const rows = await sql`
    INSERT INTO transactions (
      intent_id,
      idempotency_key,
      amount,
      currency,
      state
    )
    VALUES (
      ${input.intentId},
      ${input.idempotencyKey},
      ${input.amount},
      ${input.currency},
      'BLOCKED'
    )
    ON CONFLICT (idempotency_key)
    DO UPDATE SET
      updated_at = NOW()
    RETURNING
      id::text,
      intent_id,
      idempotency_key,
      amount,
      currency,
      state,
      created_at,
      updated_at
  `;

  return rows[0];
}
