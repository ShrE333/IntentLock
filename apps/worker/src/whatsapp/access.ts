import {neon} from "@neondatabase/serverless";
import {safeEqualText} from "../authorize/crypto";

export async function isWhatsappChatAuthorized(
  db:string,
  chatId:string
){
  const rows=await neon(db)`
    SELECT chat_id
    FROM whatsapp_authorized_chats
    WHERE chat_id=${chatId}
      AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows.length===1;
}

export async function authorizeWhatsappChat(
  db:string,
  chatId:string,
  label:string|null=null
){
  await neon(db)`
    INSERT INTO whatsapp_authorized_chats(
      chat_id,label,paired_at,revoked_at
    )
    VALUES(
      ${chatId},${label},NOW(),NULL
    )
    ON CONFLICT(chat_id)
    DO UPDATE SET
      label=COALESCE(EXCLUDED.label,whatsapp_authorized_chats.label),
      paired_at=NOW(),
      revoked_at=NULL
  `;
}

export async function revokeWhatsappChat(
  db:string,
  chatId:string
){
  await neon(db)`
    UPDATE whatsapp_authorized_chats
    SET revoked_at=NOW()
    WHERE chat_id=${chatId}
  `;
}

export function extractPairingCode(text:string){
  const m=text.trim().match(/^INTENTLOCK\s+([A-Za-z0-9_-]{8,128})$/i);
  return m?.[1]??null;
}

export function pairingCodeMatches(
  supplied:string|null,
  configured:string|undefined
){
  if(!supplied||!configured) return false;
  return safeEqualText(supplied,configured);
}

export function isWhatsappStopCommand(text:string){
  const upper=text.trim().toUpperCase();
  return upper==="INTENTLOCK STOP" || upper==="STOP INTENTLOCK";
}
