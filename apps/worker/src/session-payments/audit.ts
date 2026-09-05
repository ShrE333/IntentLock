import {neon} from "@neondatabase/serverless";
import {canonicalJson,sha256Hex} from "../db/audit";

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

  return rows[0];
}


function uuidFromHex(hex:string){
  const h=hex.slice(0,32).split("");
  h[12]="4";
  h[16]=(["8","9","a","b"])[parseInt(h[16],16)%4];
  const v=h.join("");
  return `${v.slice(0,8)}-${v.slice(8,12)}-${v.slice(12,16)}-${v.slice(16,20)}-${v.slice(20,32)}`;
}

export async function mirrorSessionTraceToAudit(
  db:string,
  sessionId:string
){
  const sql=neon(db);

  const rows:any[]=await sql`
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
  `;

  let mirrored=0;

  for(const row of rows){
    const digest=await sha256Hex(`session-trace|${String(row.event_id)}`);
    const auditEventId=uuidFromHex(digest);

    const existing:any[]=await sql`
      SELECT event_id::text
      FROM audit_events
      WHERE event_id=${auditEventId}::uuid
      LIMIT 1
    `;

    if(!existing.length){
      const occurredAt=new Date(String(row.occurred_at)).toISOString();
      const payload={
        source:"purchase_session_events",
        sessionEventId:String(row.event_id),
        eventType:String(row.event_type),
        occurredAt,
        data:row.payload??{}
      };
      const canonical=canonicalJson(payload);

      await sql`
        SELECT *
        FROM append_audit_event(
          ${auditEventId}::uuid,
          ${sessionId},
          ${String(row.event_type)},
          ${canonical}::jsonb,
          ${canonical},
          ${occurredAt}
        )
      `;
    }

    await sql`
      INSERT INTO session_audit_mirrors(
        session_event_id,session_id,audit_event_id
      )
      VALUES(
        ${String(row.event_id)},${sessionId},${auditEventId}::uuid
      )
      ON CONFLICT(session_event_id) DO NOTHING
    `;

    mirrored++;
  }

  return mirrored;
}
