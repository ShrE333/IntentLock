import {neon} from '@neondatabase/serverless';

// One SQL statement: losing/expired resolutions cannot leave a token or limit
// change behind. The wallet lock also serializes this with debit/consumption.
export const RESOLVE_STEP_UP_SQL=`
WITH wallet AS MATERIALIZED (
  SELECT * FROM intent_wallets WHERE wallet_id=$2 FOR UPDATE
), claimed AS (
  UPDATE wallet_step_up_requests r SET status=$3,resolved_at=NOW(),resolution_payload=$4::jsonb
  WHERE r.request_id=$1 AND r.wallet_id=$2 AND r.status='PENDING' AND r.expires_at>NOW()
    AND r.quote_hash=$5
    AND NOT EXISTS (SELECT 1 FROM purchase_sessions s WHERE s.step_up_request_id=r.request_id AND s.status<>'AWAITING_STEP_UP')
    AND EXISTS (SELECT 1 FROM wallet w WHERE
      ($3='REJECTED' OR (w.status='ACTIVE' AND w.valid_until>NOW()
        AND r.requested_amount>0 AND r.requested_amount<=w.max_single_transaction
        AND r.requested_amount<=w.total_authority-w.spent_amount
        AND ($3<>'LIMIT_RAISED' OR r.additional_authority_required>0))))
  RETURNING r.*
), raised AS (
  UPDATE intent_wallets w SET auto_buy_limit=GREATEST(w.auto_buy_limit,c.requested_amount),updated_at=NOW()
  FROM claimed c WHERE w.wallet_id=c.wallet_id AND c.status='LIMIT_RAISED'
  RETURNING w.auto_buy_limit
), issued AS (
  INSERT INTO wallet_one_time_authorizations(authorization_id,request_id,wallet_id,quote_hash,amount,token_hash,expires_at)
  SELECT $6,request_id,wallet_id,quote_hash,requested_amount,$7,LEAST(expires_at,$8::timestamptz)
  FROM claimed WHERE status='APPROVED_ONCE'
  RETURNING authorization_id
), session_updated AS (
  UPDATE purchase_sessions s SET
    status=CASE WHEN c.status='REJECTED' THEN 'REJECTED' ELSE 'READY_TO_PAY' END,
    authorization_id=i.authorization_id,
    selected_decision=CASE WHEN c.status='LIMIT_RAISED' THEN 'ALLOW' ELSE s.selected_decision END,
    updated_at=NOW(),completed_at=CASE WHEN c.status='REJECTED' THEN COALESCE(s.completed_at,NOW()) ELSE s.completed_at END
  FROM claimed c LEFT JOIN issued i ON TRUE
  WHERE s.step_up_request_id=c.request_id AND s.wallet_id=c.wallet_id AND s.status='AWAITING_STEP_UP'
  RETURNING s.session_id
)
SELECT c.status,c.requested_amount,i.authorization_id,r.auto_buy_limit
FROM claimed c LEFT JOIN issued i ON TRUE LEFT JOIN raised r ON TRUE`;

export async function resolveStepUpAtomic(db:string,params:unknown[]){
  const rows=await neon(db).query(RESOLVE_STEP_UP_SQL,params);
  if(!rows.length) throw new Error('STEP_UP_RESOLUTION_CONFLICT_OR_EXPIRED');
  return rows[0] as any;
}

export const CONSUME_APPROVED_AUTHORIZATION_SQL=`WITH approved AS MATERIALIZED (
  SELECT a.authorization_id FROM wallet_one_time_authorizations a
  JOIN wallet_step_up_requests r ON r.request_id=a.request_id AND r.wallet_id=a.wallet_id
  WHERE a.authorization_id=$1 AND r.status='APPROVED_ONCE' AND r.expires_at>NOW()
  FOR SHARE OF r
) SELECT consumed.* FROM approved
CROSS JOIN LATERAL consume_wallet_one_time_authorization(approved.authorization_id,$2,$3,$4,$5) consumed`;
