import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  computeAuditHash,
  verifyAuditRows,
  type AuditRow
} from "../db/audit";

describe("Tamper-evident audit chain", () => {
  it("canonicalizes object keys deterministically", () => {
    const a = canonicalJson({
      z: 1,
      nested: { b: 2, a: 1 },
      a: ["x", { q: 2, p: 1 }]
    });

    const b = canonicalJson({
      a: ["x", { p: 1, q: 2 }],
      nested: { a: 1, b: 2 },
      z: 1
    });

    expect(a).toBe(b);
  });

  it("verifies a valid two-event chain", async () => {
    const streamId = "intent_demo";
    const firstPayload = canonicalJson({ amount: 5899 });
    const secondPayload = canonicalJson({ reason: "QUOTE_CHANGED" });

    const first: AuditRow = {
      sequence: 1,
      event_id: "11111111-1111-4111-8111-111111111111",
      stream_id: streamId,
      event_type: "APPROVAL_CREATED",
      payload: { amount: 5899 },
      payload_canonical: firstPayload,
      occurred_at: "2026-09-02T07:00:00.000Z",
      occurred_at_text: "2026-09-02T07:00:00.000Z",
      previous_hash: null,
      event_hash: ""
    };

    first.event_hash = await computeAuditHash({
      previousHash: null,
      eventId: first.event_id,
      streamId,
      eventType: first.event_type,
      payloadCanonical: first.payload_canonical,
      occurredAtText: first.occurred_at_text
    });

    const second: AuditRow = {
      sequence: 2,
      event_id: "22222222-2222-4222-8222-222222222222",
      stream_id: streamId,
      event_type: "TRANSACTION_BLOCKED",
      payload: { reason: "QUOTE_CHANGED" },
      payload_canonical: secondPayload,
      occurred_at: "2026-09-02T07:00:01.000Z",
      occurred_at_text: "2026-09-02T07:00:01.000Z",
      previous_hash: first.event_hash,
      event_hash: ""
    };

    second.event_hash = await computeAuditHash({
      previousHash: first.event_hash,
      eventId: second.event_id,
      streamId,
      eventType: second.event_type,
      payloadCanonical: second.payload_canonical,
      occurredAtText: second.occurred_at_text
    });

    const result = await verifyAuditRows([first, second]);

    expect(result.valid).toBe(true);
    expect(result.checkedEvents).toBe(2);
  });

  it("detects audit payload tampering", async () => {
    const payload = canonicalJson({ moneyMoved: 0 });

    const row: AuditRow = {
      sequence: 1,
      event_id: "33333333-3333-4333-8333-333333333333",
      stream_id: "intent_tamper",
      event_type: "TRANSACTION_BLOCKED",
      payload: { moneyMoved: 0 },
      payload_canonical: payload,
      occurred_at: "2026-09-02T07:00:00.000Z",
      occurred_at_text: "2026-09-02T07:00:00.000Z",
      previous_hash: null,
      event_hash: await computeAuditHash({
        previousHash: null,
        eventId: "33333333-3333-4333-8333-333333333333",
        streamId: "intent_tamper",
        eventType: "TRANSACTION_BLOCKED",
        payloadCanonical: payload,
        occurredAtText: "2026-09-02T07:00:00.000Z"
      })
    };

    const tampered = {
      ...row,
      payload_canonical: canonicalJson({ moneyMoved: 69990 })
    };

    const result = await verifyAuditRows([tampered]);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("EVENT_HASH_MISMATCH");
  });
});
