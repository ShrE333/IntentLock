import {neon} from "@neondatabase/serverless";
import {canonicalJson} from "../db/audit";

export async function appendSessionAuditEvent(
  db:string,
  sessionId:string,
  eventType:string,
  payload:unknown
){
  const eventId=crypto.randomUUID();
  const occurredAt=new Date().toISOString();
  const canonical=canonicalJson(payload);

  const rows=await neon(db)`
    SELECT *
    FROM append_audit_event(
      ${eventId}::uuid,
      ${sessionId},
      ${eventType},
      ${canonical}::jsonb,
      ${canonical},
      ${occurredAt}
    )
  `;

  return {
    eventId,
    ...(rows[0]??{})
  };
}

export type SessionTraceRow={
  event_id:string;
  event_type:string;
  payload:unknown;
  occurred_at:string|Date;
};

export function buildSessionTraceSnapshot(rows:SessionTraceRow[]){
  return {
    version:"intentlock-session-trace-v1",
    source:"purchase_session_events",
    eventCount:rows.length,
    events:rows.map(row=>({
      sessionEventId:String(row.event_id),
      eventType:String(row.event_type),
      occurredAt:new Date(row.occurred_at).toISOString(),
      data:row.payload??{}
    }))
  };
}

/**
 * V10.8.2
 *
 * Previous implementation made up to THREE Neon HTTP requests per
 * PurchaseSession event:
 *   SELECT existing audit row
 *   append_audit_event(...)
 *   INSERT mirror row
 *
 * A normal Shopify purchase can already contain ~18 session events,
 * which is enough to exceed Cloudflare Free's per-invocation
 * subrequest ceiling once the rest of the WhatsApp/payment pipeline
 * is included.
 *
 * This implementation performs the same evidence preservation with
 * three database subrequests TOTAL:
 *
 *   1. Fetch all currently-unmirrored session events.
 *   2. Append ONE tamper-evident audit event containing the complete
 *      ordered session trace snapshot.
 *   3. Mark all exact included event IDs as mirrored in one INSERT...
 *      SELECT statement.
 *
 * New events created after this call remain unmapped and can be
 * snapshotted by a later call, so the operation is incremental.
 */
export async function mirrorSessionTraceToAudit(
  db:string,
  sessionId:string
){
  const sql=neon(db);

  const rows=await sql`
    SELECT
      pse.event_id,
      pse.event_type,
      pse.payload,
      pse.occurred_at
    FROM purchase_session_events pse
    LEFT JOIN session_audit_mirrors sam
      ON sam.session_event_id=pse.event_id
    WHERE pse.session_id=${sessionId}
      AND sam.session_event_id IS NULL
    ORDER BY pse.event_seq ASC
  ` as unknown as SessionTraceRow[];

  if(!rows.length){
    return {
      mirrored:0,
      auditEventId:null
    };
  }

  const snapshot=buildSessionTraceSnapshot(rows);

  const audit=await appendSessionAuditEvent(
    db,
    sessionId,
    "PURCHASE_SESSION_TRACE_SNAPSHOT",
    snapshot
  );

  const eventIds=JSON.stringify(
    rows.map(row=>String(row.event_id))
  );

  await sql`
    INSERT INTO session_audit_mirrors(
      session_event_id,
      session_id,
      audit_event_id
    )
    SELECT
      pse.event_id,
      pse.session_id,
      ${audit.eventId}::uuid
    FROM purchase_session_events pse
    WHERE pse.session_id=${sessionId}
      AND pse.event_id IN (
        SELECT jsonb_array_elements_text(
          ${eventIds}::jsonb
        )
      )
    ON CONFLICT(session_event_id) DO NOTHING
  `;

  return {
    mirrored:rows.length,
    auditEventId:audit.eventId
  };
}
