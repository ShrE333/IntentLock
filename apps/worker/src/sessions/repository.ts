import {neon} from "@neondatabase/serverless";
import type {CommerceProduct} from "../commerce/types";
import type {PurchaseSession,SessionStatus,SessionEvent} from "./types";

const iso=(v:unknown)=>new Date(String(v)).toISOString();
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
    razorpayPaymentLinkId:nullable(r.razorpay_payment_link_id),
    razorpayPaymentId:nullable(r.razorpay_payment_id),
    proofReceiptId:nullable(r.proof_receipt_id),
    createdAt:iso(r.created_at),
    updatedAt:iso(r.updated_at),
    completedAt:r.completed_at?iso(r.completed_at):null
  };
}

function mapEvent(r:any):SessionEvent{
  return {
    eventSeq:Number(r.event_seq),
    eventId:String(r.event_id),
    sessionId:String(r.session_id),
    eventType:String(r.event_type),
    payload:(r.payload??{}) as Record<string,unknown>,
    occurredAt:iso(r.occurred_at)
  };
}

export async function createSession(db:string,input:{
  walletId:string;channel:"WEB"|"WHATSAPP"|"API";
  connectorId:string;userPrompt:string;
}){
  const id=`ps_${crypto.randomUUID()}`;
  const rows=await neon(db)`
    INSERT INTO purchase_sessions(
      session_id,wallet_id,channel,connector_id,user_prompt,status
    ) VALUES(
      ${id},${input.walletId},${input.channel},
      ${input.connectorId},${input.userPrompt},'CREATED'
    ) RETURNING *
  `;
  return mapSession(rows[0]);
}

export async function getSession(db:string,id:string){
  const rows=await neon(db)`
    SELECT * FROM purchase_sessions
    WHERE session_id=${id} LIMIT 1
  `;
  return rows.length?mapSession(rows[0]):null;
}

export async function listSessions(db:string){
  const rows=await neon(db)`
    SELECT * FROM purchase_sessions
    ORDER BY created_at DESC LIMIT 30
  `;
  return rows.map(mapSession);
}

export async function updateSession(db:string,id:string,input:{
  status?:SessionStatus;
  selectedProduct?:CommerceProduct|null;
  selectedDecision?:"ALLOW"|"STEP_UP"|"BLOCK"|null;
  stepUpRequestId?:string|null;
  authorizationId?:string|null;
}){
  const current=await getSession(db,id);
  if(!current) return null;

  const status=input.status??current.status;
  const product=input.selectedProduct===undefined?current.selectedProduct:input.selectedProduct;
  const decision=input.selectedDecision===undefined?current.selectedDecision:input.selectedDecision;
  const stepUp=input.stepUpRequestId===undefined?current.stepUpRequestId:input.stepUpRequestId;
  const auth=input.authorizationId===undefined?current.authorizationId:input.authorizationId;
  const terminal=["CAPTURED","FAILED","CANCELLED","REJECTED"].includes(status);

  const rows=await neon(db)`
    UPDATE purchase_sessions
    SET
      status=${status},
      selected_product=${product?JSON.stringify(product):null}::jsonb,
      selected_decision=${decision},
      step_up_request_id=${stepUp},
      authorization_id=${auth},
      updated_at=NOW(),
      completed_at=CASE
        WHEN ${terminal} THEN COALESCE(completed_at,NOW())
        ELSE completed_at
      END
    WHERE session_id=${id}
    RETURNING *
  `;
  return rows.length?mapSession(rows[0]):null;
}

export async function addEvent(
  db:string,id:string,type:string,payload:Record<string,unknown>={}
){
  const eventId=`pse_${crypto.randomUUID()}`;
  const rows=await neon(db)`
    INSERT INTO purchase_session_events(
      event_id,session_id,event_type,payload
    ) VALUES(
      ${eventId},${id},${type},${JSON.stringify(payload)}::jsonb
    ) RETURNING *
  `;
  return mapEvent(rows[0]);
}

export async function getEvents(db:string,id:string){
  const rows=await neon(db)`
    SELECT * FROM purchase_session_events
    WHERE session_id=${id}
    ORDER BY event_seq ASC
  `;
  return rows.map(mapEvent);
}
