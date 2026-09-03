import {neon} from "@neondatabase/serverless";
import type {WhatsappChatState,WahaWebhook} from "./types";

function mapState(row:any):WhatsappChatState{
  return {
    chatId:String(row.chat_id),
    activeWalletId:row.active_wallet_id?String(row.active_wallet_id):null,
    activeSessionId:row.active_session_id?String(row.active_session_id):null,
    wahaSession:String(row.waha_session??"default")
  };
}

export async function claimWebhookEvent(
  db:string,eventId:string,messageId:string|null,chatId:string|null,
  eventType:string,payload:WahaWebhook
){
  const rows=await neon(db)`
    INSERT INTO whatsapp_webhook_events(event_id,message_id,chat_id,event_type,payload)
    VALUES(${eventId},${messageId},${chatId},${eventType},${JSON.stringify(payload)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING event_id
  `;
  return rows.length>0;
}

export async function ensureChatState(db:string,chatId:string,wahaSession:string){
  const rows=await neon(db)`
    INSERT INTO whatsapp_chat_state(chat_id,waha_session)
    VALUES(${chatId},${wahaSession})
    ON CONFLICT(chat_id)
    DO UPDATE SET waha_session=EXCLUDED.waha_session,updated_at=NOW()
    RETURNING *
  `;
  return mapState(rows[0]);
}

export async function getChatState(db:string,chatId:string){
  const rows=await neon(db)`
    SELECT * FROM whatsapp_chat_state WHERE chat_id=${chatId} LIMIT 1
  `;
  return rows.length?mapState(rows[0]):null;
}

export async function setActiveWallet(db:string,chatId:string,walletId:string){
  const rows=await neon(db)`
    UPDATE whatsapp_chat_state
    SET active_wallet_id=${walletId},active_session_id=NULL,updated_at=NOW()
    WHERE chat_id=${chatId}
    RETURNING *
  `;
  return rows.length?mapState(rows[0]):null;
}

export async function setActiveSession(db:string,chatId:string,sessionId:string|null){
  const rows=await neon(db)`
    UPDATE whatsapp_chat_state
    SET active_session_id=${sessionId},updated_at=NOW()
    WHERE chat_id=${chatId}
    RETURNING *
  `;
  return rows.length?mapState(rows[0]):null;
}
