import {neon} from "@neondatabase/serverless";
import type {CommerceProduct} from "../commerce/types";
import type {PurchaseSession,SessionStatus,SessionEvent} from "./types";

const iso=(v:unknown)=>v?new Date(String(v)).toISOString():null;
const nullable=(v:unknown)=>v==null?null:String(v);

function mapSession(r:any):PurchaseSession{
  return {
    sessionId:String(r.session_id),
    walletId:String(r.wallet_id),
    channel:String(r.channel) as "WEB"|"WHATSAPP"|"API",
    connectorId:String(r.connector_id),
    userPrompt:String(r.user_prompt),
    status:String(r.status) as SessionStatus,

    selectedProduct:(r.selected_product??null) as CommerceProduct|null,
    selectedDecision:(r.selected_decision??null) as "ALLOW"|"STEP_UP"|"BLOCK"|null,

    stepUpRequestId:nullable(r.step_up_request_id),
    authorizationId:nullable(r.authorization_id),

    quoteHash:nullable(r.quote_hash),
    paymentLinkUrl:nullable(r.payment_link_url),
    paymentIdempotencyKey:nullable(r.payment_idempotency_key),

    razorpayPaymentLinkId:nullable(r.razorpay_payment_link_id),
    razorpayPaymentId:nullable(r.razorpay_payment_id),

    capturedAmount:r.captured_amount==null?null:Number(r.captured_amount),
    capturedCurrency:nullable(r.captured_currency),
    capturedAt:iso(r.captured_at),

    proofReceiptId:nullable(r.proof_receipt_id),

    createdAt:new Date(String(r.created_at)).toISOString(),
    updatedAt:new Date(String(r.updated_at)).toISOString(),
    completedAt:iso(r.completed_at)
  };
}

function mapEvent(r:any):SessionEvent{
  return {
    eventSeq:Number(r.event_seq),
    eventId:String(r.event_id),
    sessionId:String(r.session_id),
    eventType:String(r.event_type),
    payload:(r.payload??{}) as Record<string,unknown>,
    occurredAt:new Date(String(r.occurred_at)).toISOString()
  };
}

export async function createSession(db:string,input:{
  walletId:string;
  channel:"WEB"|"WHATSAPP"|"API";
  connectorId:string;
  userPrompt:string;
}){
  const id=`ps_${crypto.randomUUID()}`;

  const rows=await neon(db)`
    INSERT INTO purchase_sessions(
      session_id,wallet_id,channel,connector_id,user_prompt,status
    )
    VALUES(
      ${id},${input.walletId},${input.channel},
      ${input.connectorId},${input.userPrompt},'CREATED'
    )
    RETURNING *
  `;

  return mapSession(rows[0]);
}

export async function getSession(db:string,id:string){
  const rows=await neon(db)`
    SELECT *
    FROM purchase_sessions
    WHERE session_id=${id}
    LIMIT 1
  `;

  return rows.length?mapSession(rows[0]):null;
}

export async function listSessions(db:string){
  const rows=await neon(db)`
    SELECT *
    FROM purchase_sessions
    ORDER BY created_at DESC
    LIMIT 30
  `;

  return rows.map(mapSession);
}

/**
 * V10.8.5
 * Single-query session patch.
 *
 * Older code read the session first and then updated it, turning every
 * state transition into two Neon HTTP subrequests. On Workers Free that
 * unnecessarily consumed the 50-external-subrequest budget.
 */
export async function updateSession(db:string,id:string,input:{
  status?:SessionStatus;
  selectedProduct?:CommerceProduct|null;
  selectedDecision?:"ALLOW"|"STEP_UP"|"BLOCK"|null;
  stepUpRequestId?:string|null;
  authorizationId?:string|null;
}){
  const hasStatus=input.status!==undefined;
  const hasProduct=input.selectedProduct!==undefined;
  const hasDecision=input.selectedDecision!==undefined;
  const hasStepUp=input.stepUpRequestId!==undefined;
  const hasAuthorization=input.authorizationId!==undefined;

  const status=input.status??null;
  const product=input.selectedProduct===undefined
    ? null
    : input.selectedProduct===null
      ? null
      : JSON.stringify(input.selectedProduct);

  const decision=input.selectedDecision??null;
  const stepUp=input.stepUpRequestId??null;
  const authorization=input.authorizationId??null;

  const rows=await neon(db)`
    UPDATE purchase_sessions
    SET
      status=CASE
        WHEN ${hasStatus}
          THEN ${status}::text
        ELSE status
      END,

      selected_product=CASE
        WHEN ${hasProduct}
          THEN ${product}::jsonb
        ELSE selected_product
      END,

      selected_decision=CASE
        WHEN ${hasDecision}
          THEN ${decision}::text
        ELSE selected_decision
      END,

      step_up_request_id=CASE
        WHEN ${hasStepUp}
          THEN ${stepUp}::text
        ELSE step_up_request_id
      END,

      authorization_id=CASE
        WHEN ${hasAuthorization}
          THEN ${authorization}::text
        ELSE authorization_id
      END,

      updated_at=NOW(),

      completed_at=CASE
        WHEN (
          CASE
            WHEN ${hasStatus}
              THEN ${status}::text
            ELSE status
          END
        ) IN ('CAPTURED','FAILED','CANCELLED','REJECTED')
          THEN COALESCE(completed_at,NOW())
        ELSE completed_at
      END

    WHERE session_id=${id}
    RETURNING *
  `;

  return rows.length?mapSession(rows[0]):null;
}

export async function addEvent(
  db:string,
  id:string,
  type:string,
  payload:Record<string,unknown>={}
){
  const eventId=`pse_${crypto.randomUUID()}`;

  const rows=await neon(db)`
    INSERT INTO purchase_session_events(
      event_id,session_id,event_type,payload
    )
    VALUES(
      ${eventId},
      ${id},
      ${type},
      ${JSON.stringify(payload)}::jsonb
    )
    RETURNING *
  `;

  return mapEvent(rows[0]);
}

/**
 * Insert an ordered group of Visible Agent Activity events using ONE Neon
 * HTTP request rather than one request per candidate/event.
 */
export async function addEvents(
  db:string,
  id:string,
  events:{
    type:string;
    payload?:Record<string,unknown>;
  }[]
){
  if(!events.length) return [];

  const packed=events.map((event,index)=>({
    eventId:`pse_${crypto.randomUUID()}`,
    eventType:event.type,
    payload:event.payload??{},
    order:index
  }));

  const rows=await neon(db)`
    WITH incoming AS (
      SELECT
        value,
        ordinality
      FROM jsonb_array_elements(
        ${JSON.stringify(packed)}::jsonb
      ) WITH ORDINALITY
    )
    INSERT INTO purchase_session_events(
      event_id,
      session_id,
      event_type,
      payload
    )
    SELECT
      value->>'eventId',
      ${id},
      value->>'eventType',
      COALESCE(value->'payload','{}'::jsonb)
    FROM incoming
    ORDER BY ordinality
    RETURNING *
  `;

  return rows.map(mapEvent);
}

export async function getEvents(db:string,id:string){
  const rows=await neon(db)`
    SELECT *
    FROM purchase_session_events
    WHERE session_id=${id}
    ORDER BY event_seq ASC
  `;

  return rows.map(mapEvent);
}
