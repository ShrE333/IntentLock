import type { NeonQueryFunction } from '@neondatabase/serverless';

export async function getPaymentLinkByKey(sql:NeonQueryFunction<false,false>, key:string){
  const rows=await sql`SELECT id::text, intent_id, approval_id::text, transaction_id::text, provider_link_id, reference_id, short_url, amount, currency, status, expires_at FROM payment_links WHERE idempotency_key=${key} LIMIT 1`;
  return rows[0] ?? null;
}

export async function persistPaymentLink(sql:NeonQueryFunction<false,false>, input:{
  intentId:string; approvalId:string; idempotencyKey:string; providerLinkId:string;
  referenceId:string; shortUrl:string; amount:number; currency:'INR'; status:string; expiresAt:string;
}){
  const tx=await sql`
    INSERT INTO transactions(intent_id,approval_id,provider,provider_payment_id,idempotency_key,amount,currency,state)
    VALUES(${input.intentId},${input.approvalId}::uuid,'razorpay',${input.providerLinkId},${input.idempotencyKey},${input.amount},${input.currency},'CREATED')
    ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=NOW()
    RETURNING id::text`;
  const transactionId=String(tx[0].id);
  const rows=await sql`
    INSERT INTO payment_links(intent_id,approval_id,transaction_id,idempotency_key,provider_link_id,reference_id,short_url,amount,currency,status,expires_at)
    VALUES(${input.intentId},${input.approvalId}::uuid,${transactionId}::uuid,${input.idempotencyKey},${input.providerLinkId},${input.referenceId},${input.shortUrl},${input.amount},${input.currency},${input.status},${input.expiresAt}::timestamptz)
    ON CONFLICT(idempotency_key) DO UPDATE SET short_url=EXCLUDED.short_url,status=EXCLUDED.status,updated_at=NOW()
    RETURNING id::text,transaction_id::text,provider_link_id,reference_id,short_url,amount,currency,status,expires_at`;
  return rows[0];
}

export async function persistWebhook(sql:NeonQueryFunction<false,false>, input:{payloadHash:string;eventType:string;providerEntityId:string|null;payload:unknown}){
  const rows=await sql`
    INSERT INTO webhook_events(provider,payload_hash,event_type,provider_entity_id,signature_valid,payload,processed_at)
    VALUES('razorpay',${input.payloadHash},${input.eventType},${input.providerEntityId},TRUE,${JSON.stringify(input.payload)}::jsonb,NOW())
    ON CONFLICT(provider,payload_hash) DO NOTHING RETURNING id::text`;
  return rows.length===1;
}

export async function markPaymentLinkPaid(sql:NeonQueryFunction<false,false>, providerLinkId:string, providerPaymentId:string|null){
  const links=await sql`UPDATE payment_links SET status='paid',updated_at=NOW() WHERE provider_link_id=${providerLinkId} RETURNING intent_id,transaction_id::text`;
  if(!links.length) return null;
  const txId=String(links[0].transaction_id);
  await sql`UPDATE transactions SET state='CAPTURED',provider_payment_id=COALESCE(${providerPaymentId},provider_payment_id),updated_at=NOW() WHERE id=${txId}::uuid`;
  return {intentId:String(links[0].intent_id),transactionId:txId};
}
