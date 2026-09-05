import {describe,it,expect} from "vitest";
import {
  buildSessionTraceSnapshot
} from "../session-payments/audit";

describe("V10.8.2 batched PurchaseSession audit snapshot",()=>{
  it("preserves the complete ordered session trace in one payload",()=>{
    const snapshot=buildSessionTraceSnapshot([
      {
        event_id:"pse_1",
        event_type:"SESSION_CREATED",
        payload:{channel:"WHATSAPP"},
        occurred_at:"2026-09-05T15:54:49.000Z"
      },
      {
        event_id:"pse_2",
        event_type:"POLICY_DECISION",
        payload:{decision:"ALLOW",amount:5899},
        occurred_at:"2026-09-05T15:54:50.000Z"
      }
    ]);

    expect(snapshot.eventCount).toBe(2);
    expect(snapshot.events[0].eventType).toBe("SESSION_CREATED");
    expect(snapshot.events[1].eventType).toBe("POLICY_DECISION");
    expect(snapshot.events[1].data).toEqual({
      decision:"ALLOW",
      amount:5899
    });
  });

  it("produces a deterministic evidence structure for empty/null payloads",()=>{
    const snapshot=buildSessionTraceSnapshot([
      {
        event_id:"pse_1",
        event_type:"SEARCH_STARTED",
        payload:null,
        occurred_at:new Date("2026-09-05T15:54:49.000Z")
      }
    ]);

    expect(snapshot.events[0].data).toEqual({});
    expect(snapshot.events[0].occurredAt)
      .toBe("2026-09-05T15:54:49.000Z");
  });
});
