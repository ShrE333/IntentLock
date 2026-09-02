import type { NeonQueryFunction } from "@neondatabase/serverless";

export type AuditEventType =
  | "INTENT_CREATED"
  | "MERCHANT_DATA_READ"
  | "AGENT_PROPOSAL_CREATED"
  | "POLICY_CHECKED"
  | "APPROVAL_CREATED"
  | "APPROVAL_VERIFIED"
  | "QUOTE_CHANGED"
  | "IDEMPOTENCY_CLAIMED"
  | "DUPLICATE_CHECKOUT_REJECTED"
  | "TRANSACTION_BLOCKED"
  | "PAYMENT_LINK_CREATED"
  | "WEBHOOK_RECEIVED"
  | "WEBHOOK_DUPLICATE_IGNORED"
  | "PAYMENT_CREATED"
  | "PAYMENT_CAPTURED"
  | "PAYMENT_FAILED";

export type AuditRow = {
  sequence: number | string;
  event_id: string;
  stream_id: string;
  event_type: string;
  payload: unknown;
  payload_canonical: string;
  occurred_at: string | Date;
  occurred_at_text: string;
  previous_hash: string | null;
  event_hash: string;
};

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }

  if (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof Date)
  ) {
    const object = value as Record<string, unknown>;
    return Object.keys(object)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalizeValue(object[key]);
        return acc;
      }, {});
  }

  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encodeText(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export async function computeAuditHash(input: {
  previousHash: string | null;
  eventId: string;
  streamId: string;
  eventType: string;
  payloadCanonical: string;
  occurredAtText: string;
}): Promise<string> {
  return sha256Hex(
    [
      input.previousHash ?? "GENESIS",
      input.eventId,
      input.streamId,
      input.eventType,
      input.payloadCanonical,
      input.occurredAtText
    ].join("|")
  );
}

export async function appendAuditEvent(
  sql: NeonQueryFunction<false, false>,
  streamId: string,
  eventType: AuditEventType,
  payload: unknown,
  occurredAt = new Date()
) {
  const eventId = crypto.randomUUID();
  const occurredAtText = occurredAt.toISOString();
  const payloadCanonical = canonicalJson(payload);

  const rows = await sql`
    SELECT *
    FROM append_audit_event(
      ${eventId}::uuid,
      ${streamId},
      ${eventType},
      ${payloadCanonical}::jsonb,
      ${payloadCanonical},
      ${occurredAtText}
    )
  `;

  return rows[0];
}

export async function getAuditEvents(
  sql: NeonQueryFunction<false, false>,
  streamId: string
): Promise<AuditRow[]> {
  const rows = await sql`
    SELECT
      sequence,
      event_id::text,
      stream_id,
      event_type,
      payload,
      payload_canonical,
      occurred_at,
      occurred_at_text,
      previous_hash,
      event_hash
    FROM audit_events
    WHERE stream_id = ${streamId}
    ORDER BY sequence ASC
  `;

  return rows as AuditRow[];
}

export async function verifyAuditRows(rows: AuditRow[]) {
  let previousHash: string | null = null;

  for (const row of rows) {
    if ((row.previous_hash ?? null) !== previousHash) {
      return {
        valid: false,
        checkedEvents: rows.indexOf(row),
        brokenAtSequence: Number(row.sequence),
        reason: "PREVIOUS_HASH_MISMATCH"
      };
    }

    const expected = await computeAuditHash({
      previousHash,
      eventId: row.event_id,
      streamId: row.stream_id,
      eventType: row.event_type,
      payloadCanonical: row.payload_canonical,
      occurredAtText: row.occurred_at_text
    });

    if (expected !== row.event_hash) {
      return {
        valid: false,
        checkedEvents: rows.indexOf(row),
        brokenAtSequence: Number(row.sequence),
        reason: "EVENT_HASH_MISMATCH",
        expected,
        actual: row.event_hash
      };
    }

    previousHash = row.event_hash;
  }

  return {
    valid: true,
    checkedEvents: rows.length,
    headHash: previousHash
  };
}
