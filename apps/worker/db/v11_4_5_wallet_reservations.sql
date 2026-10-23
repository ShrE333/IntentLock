-- Additive. Apply only after reviewing V11.4.5 rollout gates. No backfill.
-- The wallet row is the serialization point for every authority transfer.
BEGIN;
ALTER TABLE intent_wallets ADD COLUMN IF NOT EXISTS reserved_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE intent_wallets ADD CONSTRAINT wallet_reserved_authority_v11_4_5
 CHECK (reserved_amount >= 0 AND spent_amount + reserved_amount <= total_authority);
CREATE FUNCTION protect_wallet_reservation_counter_v11_4_5() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.reserved_amount IS DISTINCT FROM OLD.reserved_amount AND pg_trigger_depth()<2 THEN
  RAISE EXCEPTION 'RESERVATION_COUNTER_MANAGED';
 END IF;
 IF NEW.currency IS DISTINCT FROM OLD.currency AND (OLD.reserved_amount>0 OR OLD.spent_amount>0) THEN
  RAISE EXCEPTION 'WALLET_FINANCIAL_CURRENCY_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wallet_reservation_counter_guard BEFORE UPDATE ON intent_wallets FOR EACH ROW
 EXECUTE FUNCTION protect_wallet_reservation_counter_v11_4_5();

CREATE TABLE wallet_authority_reservations (
 reservation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id TEXT NOT NULL UNIQUE REFERENCES purchase_sessions(session_id) ON DELETE RESTRICT,
 wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id) ON DELETE RESTRICT,
 quote_hash TEXT NOT NULL,
 operation_key TEXT NOT NULL UNIQUE,
 amount NUMERIC NOT NULL CHECK (amount > 0 AND amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
 currency TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('paypal','razorpay')),
 state TEXT NOT NULL DEFAULT 'RESERVED' CHECK(state IN ('RESERVED','COMMITTED','RELEASED','EXPIRED','RECONCILIATION_REQUIRED')),
 phase TEXT NOT NULL DEFAULT 'NONE' CHECK(phase IN ('NONE','CHECKOUT','AUTHORIZE','CAPTURE')),
 provider_order_id TEXT,
 provider_authorization_id TEXT,
 provider_capture_id TEXT,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 execution_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX wallet_reservation_provider_order ON wallet_authority_reservations(provider,provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX wallet_reservation_provider_authorization ON wallet_authority_reservations(provider,provider_authorization_id) WHERE provider_authorization_id IS NOT NULL;
CREATE UNIQUE INDEX wallet_reservation_provider_capture ON wallet_authority_reservations(provider,provider_capture_id) WHERE provider_capture_id IS NOT NULL;
CREATE INDEX wallet_reservation_pending ON wallet_authority_reservations(wallet_id,state);
-- Installation fails if historical duplicate capture identities exist. Review
-- them separately; this migration never rewrites or deduplicates paid records.
CREATE UNIQUE INDEX wallet_ledger_provider_capture_v11_4_5 ON wallet_spend_ledger(provider,provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE TABLE wallet_reservation_release_evidence (
 reservation_id UUID PRIMARY KEY REFERENCES wallet_authority_reservations(reservation_id),
 provider_order JSONB NOT NULL,
 provider_authorization JSONB NOT NULL,
 verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE wallet_reservation_terminal_evidence (
 reservation_id UUID PRIMARY KEY REFERENCES wallet_authority_reservations(reservation_id),
 payload_hash TEXT NOT NULL,
 verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE wallet_reservation_events (
 event_id BIGSERIAL PRIMARY KEY,
 reservation_id UUID NOT NULL REFERENCES wallet_authority_reservations(reservation_id),
 from_state TEXT,
 to_state TEXT NOT NULL,
 phase TEXT NOT NULL,
 reason TEXT NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- All writes, including recovery/operator SQL, must obey lifecycle and counter
-- conservation. COMMITTED additionally requires the matching ledger to exist.
CREATE FUNCTION enforce_wallet_reservation_v11_4_5() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_delta NUMERIC; v_wallet intent_wallets%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RESERVATION_IMMUTABLE'; END IF;
 SELECT * INTO v_wallet FROM intent_wallets WHERE wallet_id=NEW.wallet_id FOR UPDATE;
 IF TG_OP='UPDATE' THEN
  IF (NEW.session_id,NEW.wallet_id,NEW.amount,NEW.currency,NEW.quote_hash,NEW.operation_key,NEW.provider,NEW.expires_at,NEW.created_at)
    IS DISTINCT FROM (OLD.session_id,OLD.wallet_id,OLD.amount,OLD.currency,OLD.quote_hash,OLD.operation_key,OLD.provider,OLD.expires_at,OLD.created_at)
    THEN RAISE EXCEPTION 'RESERVATION_IDENTITY_IMMUTABLE'; END IF;
  IF OLD.state IN ('COMMITTED','RELEASED','EXPIRED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'RESERVATION_TERMINAL'; END IF;
  IF NEW.state<>OLD.state AND NOT (
    (OLD.state='RESERVED' AND NEW.state IN ('RECONCILIATION_REQUIRED','COMMITTED','RELEASED','EXPIRED')) OR
    (OLD.state='RECONCILIATION_REQUIRED' AND NEW.state IN ('RESERVED','COMMITTED','RELEASED'))
  ) THEN RAISE EXCEPTION 'RESERVATION_TRANSITION_INVALID'; END IF;
  IF (OLD.phase='CAPTURE' AND NEW.phase<>'CAPTURE') OR
     (OLD.phase='AUTHORIZE' AND NEW.phase NOT IN ('AUTHORIZE','CAPTURE')) OR
     (OLD.phase='CHECKOUT' AND NEW.phase='NONE') THEN RAISE EXCEPTION 'RESERVATION_PHASE_REGRESSION'; END IF;
  IF (OLD.provider_order_id IS NOT NULL AND NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id) OR
     (OLD.provider_authorization_id IS NOT NULL AND NEW.provider_authorization_id IS DISTINCT FROM OLD.provider_authorization_id) OR
     (OLD.provider_capture_id IS NOT NULL AND NEW.provider_capture_id IS DISTINCT FROM OLD.provider_capture_id) THEN RAISE EXCEPTION 'RESERVATION_PROVIDER_ID_IMMUTABLE'; END IF;
 END IF;
 IF TG_OP='INSERT' AND (NEW.state<>'RESERVED' OR NEW.phase<>'NONE') THEN RAISE EXCEPTION 'RESERVATION_INITIAL_STATE_INVALID'; END IF;
 IF NEW.state='EXPIRED' AND (NOT (NEW.phase='NONE' OR (NEW.provider='paypal' AND NEW.phase='CHECKOUT' AND NEW.provider_authorization_id IS NULL)) OR NEW.expires_at>NOW()) THEN RAISE EXCEPTION 'RESERVATION_UNSAFE_EXPIRY'; END IF;
 IF NEW.state='RELEASED' AND NEW.phase<>'NONE'
  AND NOT EXISTS(SELECT 1 FROM wallet_reservation_release_evidence e WHERE e.reservation_id=NEW.reservation_id)
  AND NOT EXISTS(SELECT 1 FROM wallet_reservation_terminal_evidence e WHERE e.reservation_id=NEW.reservation_id)
 THEN RAISE EXCEPTION 'RESERVATION_RELEASE_EVIDENCE_REQUIRED'; END IF;
 IF NEW.state='COMMITTED' AND NOT EXISTS (
  SELECT 1 FROM wallet_spend_ledger l WHERE l.session_id=NEW.session_id AND l.wallet_id=NEW.wallet_id
   AND l.amount=NEW.amount AND l.currency=NEW.currency AND l.provider=NEW.provider
   AND l.provider_link_id=NEW.provider_order_id AND l.provider_payment_id=NEW.provider_capture_id
 ) THEN RAISE EXCEPTION 'RESERVATION_LEDGER_REQUIRED'; END IF;
 v_delta=CASE WHEN NEW.state IN ('RESERVED','RECONCILIATION_REQUIRED') THEN NEW.amount ELSE 0 END;
 IF TG_OP='UPDATE' AND OLD.state IN ('RESERVED','RECONCILIATION_REQUIRED') THEN v_delta=v_delta-OLD.amount; END IF;
 UPDATE intent_wallets SET reserved_amount=reserved_amount+v_delta,updated_at=NOW() WHERE wallet_id=NEW.wallet_id;
 NEW.updated_at=NOW();
 INSERT INTO wallet_reservation_events(reservation_id,from_state,to_state,phase,reason)
 VALUES(NEW.reservation_id,CASE WHEN TG_OP='UPDATE' THEN OLD.state ELSE NULL END,NEW.state,NEW.phase,TG_OP);
 RETURN NEW;
END $$;
-- AFTER permits the event FK and atomically rolls back an invalid insertion.
CREATE TRIGGER wallet_reservation_integrity AFTER INSERT OR UPDATE OR DELETE ON wallet_authority_reservations
 FOR EACH ROW EXECUTE FUNCTION enforce_wallet_reservation_v11_4_5();

CREATE FUNCTION reserve_wallet_authority_v11_4_5(
 p_session TEXT,p_wallet TEXT,p_quote TEXT,p_key TEXT,p_amount NUMERIC,p_currency TEXT,p_provider TEXT
) RETURNS SETOF wallet_authority_reservations LANGUAGE plpgsql AS $$
DECLARE w intent_wallets%ROWTYPE; s purchase_sessions%ROWTYPE; r wallet_authority_reservations%ROWTYPE; digits INTEGER;
BEGIN
 SELECT * INTO w FROM intent_wallets WHERE wallet_id=p_wallet FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;
 SELECT * INTO s FROM purchase_sessions WHERE session_id=p_session FOR SHARE;
 IF NOT FOUND OR s.wallet_id IS DISTINCT FROM p_wallet THEN RAISE EXCEPTION 'RESERVATION_SESSION_WALLET_MISMATCH'; END IF;
 SELECT * INTO r FROM wallet_authority_reservations WHERE session_id=p_session;
 IF FOUND THEN
  IF (r.wallet_id,r.quote_hash,r.operation_key,r.amount,r.currency,r.provider) IS DISTINCT FROM
    (p_wallet,p_quote,p_key,p_amount,p_currency,p_provider) THEN RAISE EXCEPTION 'RESERVATION_IDENTITY_MISMATCH'; END IF;
  IF r.state NOT IN ('RESERVED','RECONCILIATION_REQUIRED') THEN RAISE EXCEPTION 'RESERVATION_TERMINAL'; END IF;
  RETURN NEXT r; RETURN;
 END IF;
 IF w.status<>'ACTIVE' OR w.valid_until<=NOW() THEN RAISE EXCEPTION 'WALLET_AUTHORITY_INACTIVE'; END IF;
 IF s.status<>'READY_TO_PAY' THEN RAISE EXCEPTION 'RESERVATION_SESSION_NOT_READY'; END IF;
 digits=CASE WHEN p_currency IN ('JPY','KRW','VND','CLP','XAF','XOF','XPF','BIF','DJF','GNF','KMF','PYG','RWF','UGX','VUV','ISK') THEN 0
 WHEN p_currency IN ('BHD','IQD','JOD','KWD','LYD','OMR','TND') THEN 3 ELSE 2 END;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
  OR p_amount<>trunc(p_amount,LEAST(digits,2)) OR p_currency IS DISTINCT FROM w.currency
  OR p_amount IS DISTINCT FROM COALESCE((s.selected_product #>> '{authorizationContext,walletAmount}')::numeric,(s.selected_product->>'price')::numeric)
  OR p_currency IS DISTINCT FROM COALESCE(s.selected_product #>> '{authorizationContext,walletCurrency}',s.selected_product->>'currency')
  OR p_amount>w.max_single_transaction THEN RAISE EXCEPTION 'RESERVATION_AMOUNT_INVALID'; END IF;
 -- A pre-upgrade outstanding provider object may already have moved money.
 -- Never assign its unaccounted authority to a new session.
 IF EXISTS (SELECT 1 FROM session_payment_links p WHERE p.wallet_id=p_wallet
  AND NOT EXISTS(SELECT 1 FROM wallet_authority_reservations a WHERE a.session_id=p.session_id)
  AND NOT EXISTS(SELECT 1 FROM wallet_spend_ledger l WHERE l.session_id=p.session_id)) THEN
  RAISE EXCEPTION 'LEGACY_PAYMENT_RECONCILIATION_REQUIRED'; END IF;
 -- These PayPal AUTHORIZE orders have never started authorization. Once expired,
 -- the durable terminal reservation prevents any subsequent authorization.
 UPDATE wallet_authority_reservations SET state='EXPIRED' WHERE wallet_id=p_wallet AND state='RESERVED' AND expires_at<=NOW()
  AND (phase='NONE' OR (provider='paypal' AND phase='CHECKOUT' AND provider_authorization_id IS NULL));
 SELECT * INTO w FROM intent_wallets WHERE wallet_id=p_wallet;
 IF w.spent_amount+w.reserved_amount+p_amount>w.total_authority THEN RAISE EXCEPTION 'WALLET_AVAILABLE_AUTHORITY_EXCEEDED'; END IF;
 INSERT INTO wallet_authority_reservations(session_id,wallet_id,quote_hash,operation_key,amount,currency,provider,expires_at)
 VALUES(p_session,p_wallet,p_quote,p_key,p_amount,p_currency,p_provider,LEAST(w.valid_until,NOW()+INTERVAL '20 minutes')) RETURNING * INTO r;
 RETURN NEXT r;
END $$;

-- Admission marker is persisted BEFORE a network mutation. No automatic retry of
-- ambiguous mutations: reconciliation may replay provider evidence, not spend again.
CREATE FUNCTION begin_wallet_provider_operation_v11_4_5(p_session TEXT,p_quote TEXT,p_phase TEXT)
 RETURNS SETOF wallet_authority_reservations LANGUAGE plpgsql AS $$
DECLARE w intent_wallets%ROWTYPE; r wallet_authority_reservations%ROWTYPE; s purchase_sessions%ROWTYPE;
BEGIN
 SELECT w0.* INTO w FROM intent_wallets w0 JOIN wallet_authority_reservations r0 ON r0.wallet_id=w0.wallet_id WHERE r0.session_id=p_session FOR UPDATE OF w0;
 SELECT * INTO r FROM wallet_authority_reservations WHERE session_id=p_session FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_REQUIRED'; END IF;
 IF r.state<>'RESERVED' OR r.quote_hash IS DISTINCT FROM p_quote OR r.expires_at<=NOW()
  OR w.status<>'ACTIVE' OR w.valid_until<=NOW() OR r.currency<>w.currency OR r.amount>w.max_single_transaction
 THEN RAISE EXCEPTION 'RESERVATION_NOT_EXECUTABLE'; END IF;
 SELECT * INTO s FROM purchase_sessions WHERE session_id=p_session FOR SHARE;
 IF (p_phase<>'CHECKOUT' OR r.provider='razorpay') AND (r.amount>w.auto_buy_limit OR s.selected_decision='STEP_UP') AND NOT EXISTS (
  SELECT 1 FROM wallet_one_time_authorizations a JOIN wallet_step_up_requests q ON q.request_id=a.request_id
  WHERE a.authorization_id=s.authorization_id AND a.wallet_id=r.wallet_id AND a.quote_hash=r.quote_hash AND a.amount=r.amount
   AND a.consumed_by_session_id=p_session AND a.expires_at>NOW() AND q.status='APPROVED_ONCE' AND q.expires_at>NOW()
 ) THEN RAISE EXCEPTION 'RESERVATION_APPROVAL_REQUIRED'; END IF;
 IF NOT ((p_phase='CHECKOUT' AND r.phase='NONE') OR (p_phase='AUTHORIZE' AND r.provider='paypal' AND r.phase='CHECKOUT' AND r.provider_order_id IS NOT NULL)
 OR (p_phase='CAPTURE' AND r.provider='paypal' AND r.phase='AUTHORIZE' AND r.provider_authorization_id IS NOT NULL)) THEN RAISE EXCEPTION 'RESERVATION_OPERATION_INVALID'; END IF;
 UPDATE wallet_authority_reservations SET state='RECONCILIATION_REQUIRED',phase=p_phase,execution_at=NOW() WHERE session_id=p_session RETURNING * INTO r;
 RETURN NEXT r;
END $$;

CREATE FUNCTION confirm_wallet_provider_operation_v11_4_5(p_session TEXT,p_phase TEXT,p_order TEXT,p_auth TEXT,p_capture TEXT)
 RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM intent_wallets w JOIN wallet_authority_reservations r ON r.wallet_id=w.wallet_id WHERE r.session_id=p_session FOR UPDATE OF w;
 UPDATE wallet_authority_reservations SET state='RESERVED',provider_order_id=COALESCE(p_order,provider_order_id),
 provider_authorization_id=COALESCE(p_auth,provider_authorization_id),provider_capture_id=COALESCE(p_capture,provider_capture_id)
 WHERE session_id=p_session AND state='RECONCILIATION_REQUIRED' AND phase=p_phase;
 -- A webhook may have already committed. Never regress that terminal state.
END $$;

CREATE FUNCTION release_unused_wallet_reservation_v11_4_5(p_session TEXT,p_expire BOOLEAN DEFAULT FALSE)
 RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM intent_wallets w JOIN wallet_authority_reservations r ON r.wallet_id=w.wallet_id WHERE r.session_id=p_session FOR UPDATE OF w;
 UPDATE wallet_authority_reservations SET state=CASE WHEN p_expire THEN 'EXPIRED' ELSE 'RELEASED' END
 WHERE session_id=p_session AND state='RESERVED'
  AND (phase='NONE' OR (p_expire AND provider='paypal' AND phase='CHECKOUT' AND provider_authorization_id IS NULL))
  AND (NOT p_expire OR expires_at<=NOW());
 RETURN FOUND;
END $$;

-- Only server-fetched terminal authorization truth may release an existing hold.
-- In-flight/ambiguous capture is deliberately excluded, even if a later GET says
-- VOIDED: it may already have captured and its completion evidence must reconcile.
CREATE FUNCTION release_voided_wallet_reservation_v11_4_5(p_session TEXT,p_order JSONB,p_auth JSONB)
 RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE r wallet_authority_reservations%ROWTYPE;
BEGIN
 PERFORM 1 FROM intent_wallets w JOIN wallet_authority_reservations a ON a.wallet_id=w.wallet_id WHERE a.session_id=p_session FOR UPDATE OF w;
 SELECT * INTO r FROM wallet_authority_reservations WHERE session_id=p_session FOR UPDATE;
 IF r.state IS DISTINCT FROM 'RESERVED' OR r.phase IS DISTINCT FROM 'AUTHORIZE' OR r.provider<>'paypal'
  OR p_order->>'id' IS DISTINCT FROM r.provider_order_id OR p_order->>'intent' IS DISTINCT FROM 'AUTHORIZE'
  OR p_auth->>'id' IS DISTINCT FROM r.provider_authorization_id OR p_auth->>'status' NOT IN ('VOIDED','EXPIRED')
  OR p_auth->>'status' IS NULL
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_order->'purchase_units') u,
    jsonb_array_elements(COALESCE(u->'payments'->'captures','[]'::jsonb)) c)
 THEN RETURN FALSE; END IF;
 INSERT INTO wallet_reservation_release_evidence(reservation_id,provider_order,provider_authorization) VALUES(r.reservation_id,p_order,p_auth);
 UPDATE wallet_authority_reservations SET state='RELEASED' WHERE session_id=p_session;
 RETURN TRUE;
END $$;

-- Recovery binds an authorization discovered via authenticated GETs, never via
-- a browser field, and never replays the financial authorization request.
CREATE FUNCTION recover_wallet_authorization_v11_4_5(p_session TEXT,p_order JSONB,p_auth JSONB)
 RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE r wallet_authority_reservations%ROWTYPE; p session_payment_links%ROWTYPE;
BEGIN
 PERFORM 1 FROM intent_wallets w JOIN wallet_authority_reservations a ON a.wallet_id=w.wallet_id WHERE a.session_id=p_session FOR UPDATE OF w;
 SELECT * INTO r FROM wallet_authority_reservations WHERE session_id=p_session FOR UPDATE;
 SELECT * INTO p FROM session_payment_links WHERE session_id=p_session FOR UPDATE;
 IF r.state IS DISTINCT FROM 'RECONCILIATION_REQUIRED' OR r.phase IS DISTINCT FROM 'AUTHORIZE' OR r.provider<>'paypal'
  OR p_order->>'id' IS DISTINCT FROM r.provider_order_id OR p_order->>'intent' IS DISTINCT FROM 'AUTHORIZE'
  OR p.provider_order_id IS DISTINCT FROM r.provider_order_id OR p.wallet_id IS DISTINCT FROM r.wallet_id
  OR p_auth->>'id' IS NULL OR p_auth->>'status' IS NULL OR p_auth->>'status' NOT IN ('CREATED','PENDING','VOIDED','EXPIRED')
  OR (p_auth #>> '{amount,value}')::numeric IS DISTINCT FROM p.amount
  OR p_auth #>> '{amount,currency_code}' IS DISTINCT FROM p.currency
  OR (r.provider_authorization_id IS NOT NULL AND r.provider_authorization_id<>p_auth->>'id')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_order->'purchase_units') u,
    jsonb_array_elements(COALESCE(u->'payments'->'authorizations','[]'::jsonb)) a WHERE a->>'id'=p_auth->>'id' AND u->>'custom_id'=p_session)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_order->'purchase_units') u,
    jsonb_array_elements(COALESCE(u->'payments'->'captures','[]'::jsonb)) c)
 THEN RETURN FALSE; END IF;
 UPDATE wallet_authority_reservations SET state='RESERVED',provider_authorization_id=p_auth->>'id' WHERE session_id=p_session;
 UPDATE session_payment_links SET status='AUTHORIZED',provider_authorization_id=p_auth->>'id',updated_at=NOW() WHERE session_id=p_session;
 UPDATE purchase_sessions SET status='AUTHORIZED',provider_authorization_id=p_auth->>'id',updated_at=NOW() WHERE session_id=p_session AND status IN ('PAYPAL_APPROVAL_PENDING','AUTHORIZED');
 RETURN TRUE;
END $$;

CREATE FUNCTION release_denied_wallet_capture_v11_4_5(p_session TEXT,p_hash TEXT)
 RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE r wallet_authority_reservations%ROWTYPE; p session_payment_links%ROWTYPE; e JSONB; capture_id TEXT;
BEGIN
 PERFORM 1 FROM intent_wallets w JOIN wallet_authority_reservations a ON a.wallet_id=w.wallet_id WHERE a.session_id=p_session FOR UPDATE OF w;
 SELECT * INTO r FROM wallet_authority_reservations WHERE session_id=p_session FOR UPDATE;
 IF NOT FOUND OR r.state NOT IN ('RESERVED','RECONCILIATION_REQUIRED') OR r.phase<>'CAPTURE' OR r.provider<>'paypal' THEN RETURN FALSE; END IF;
 SELECT * INTO p FROM session_payment_links WHERE session_id=p_session FOR SHARE;
 SELECT payload,provider_payment_id INTO e,capture_id FROM session_payment_webhook_events
 WHERE payload_hash=p_hash AND session_id=p_session AND provider='paypal' AND event_type='PAYMENT.CAPTURE.DENIED'
  AND provider_link_id=r.provider_order_id;
 IF NOT FOUND OR capture_id IS NULL OR e->>'event_type' IS DISTINCT FROM 'PAYMENT.CAPTURE.DENIED'
  OR e #>> '{resource,id}' IS DISTINCT FROM capture_id
  OR e #>> '{resource,status}' IS NULL OR e #>> '{resource,status}' NOT IN ('DECLINED','DENIED')
  OR e #>> '{resource,supplementary_data,related_ids,order_id}' IS DISTINCT FROM r.provider_order_id
  OR e #>> '{resource,supplementary_data,related_ids,authorization_id}' IS DISTINCT FROM r.provider_authorization_id
  OR (e #>> '{resource,amount,value}')::numeric IS DISTINCT FROM p.amount
  OR e #>> '{resource,amount,currency_code}' IS DISTINCT FROM p.currency
  OR (r.provider_capture_id IS NOT NULL AND r.provider_capture_id<>capture_id)
  OR (p.provider_capture_id IS NOT NULL AND p.provider_capture_id<>capture_id)
 THEN RAISE EXCEPTION 'VERIFIED_DENIAL_MISMATCH'; END IF;
 INSERT INTO wallet_reservation_terminal_evidence(reservation_id,payload_hash) VALUES(r.reservation_id,p_hash);
 UPDATE wallet_authority_reservations SET state='RELEASED',provider_capture_id=capture_id WHERE session_id=p_session;
 RETURN TRUE;
END $$;

-- Provider evidence is stored only by independently verified webhook ingress.
-- The reservation transfer, ledger insertion and wallet debit are ONE transaction.
CREATE FUNCTION settle_wallet_reservation_v11_4_5(
 p_session TEXT,p_wallet TEXT,p_amount NUMERIC,p_currency TEXT,p_provider TEXT,p_order TEXT,p_capture TEXT,p_evidence TEXT
) RETURNS TABLE(applied BOOLEAN,ledger_id UUID,spent_amount NUMERIC,remaining_authority NUMERIC)
 LANGUAGE plpgsql AS $$
DECLARE w intent_wallets%ROWTYPE; r wallet_authority_reservations%ROWTYPE; l wallet_spend_ledger%ROWTYPE;
 p session_payment_links%ROWTYPE; s purchase_sessions%ROWTYPE; e JSONB;
BEGIN
 SELECT * INTO w FROM intent_wallets WHERE wallet_id=p_wallet FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
  OR p_provider IS NULL OR p_provider NOT IN ('paypal','razorpay') OR p_currency IS DISTINCT FROM w.currency
 THEN RAISE EXCEPTION 'RESERVATION_AMOUNT_INVALID'; END IF;
 SELECT * INTO r FROM wallet_authority_reservations WHERE session_id=p_session FOR UPDATE;
 IF NOT FOUND THEN
  -- Never manufacture a reservation for an already executed historical payment.
  -- Keep its original verified-evidence reconciliation and ledger replay checks.
  IF p_provider='paypal' THEN
   RETURN QUERY SELECT * FROM reconcile_paypal_wallet_spend_once_v11_0_3(p_session,p_wallet,p_amount,p_currency,p_provider,p_order,p_capture,p_evidence);
  ELSE
   SELECT payload INTO e FROM session_payment_webhook_events WHERE payload_hash=p_evidence AND session_id=p_session
    AND provider='razorpay' AND event_type='payment_link.paid' AND provider_link_id=p_order AND provider_payment_id=p_capture;
   IF NOT FOUND OR e #>> '{payload,payment,entity,id}' IS DISTINCT FROM p_capture
    OR e #>> '{payload,payment_link,entity,id}' IS DISTINCT FROM p_order
    OR (e #>> '{payload,payment,entity,amount}')::numeric IS DISTINCT FROM p_amount*100
    OR e #>> '{payload,payment,entity,currency}' IS DISTINCT FROM p_currency
    OR e #>> '{payload,payment,entity,status}' IS DISTINCT FROM 'captured'
   THEN RAISE EXCEPTION 'VERIFIED_SETTLEMENT_EVIDENCE_REQUIRED'; END IF;
   RETURN QUERY SELECT * FROM apply_intent_wallet_spend_once_v11(p_session,p_wallet,p_amount,p_currency,p_provider,p_order,p_capture);
  END IF;
  RETURN;
 END IF;
 SELECT * INTO p FROM session_payment_links WHERE session_id=p_session FOR SHARE;
 SELECT * INTO s FROM purchase_sessions WHERE session_id=p_session FOR SHARE;
 IF (r.wallet_id,r.amount,r.currency,r.provider,r.quote_hash,r.operation_key) IS DISTINCT FROM
    (p_wallet,p_amount,p_currency,p_provider,p.quote_hash::text,p.idempotency_key::text)
  OR p.wallet_id IS DISTINCT FROM p_wallet OR s.wallet_id IS DISTINCT FROM p_wallet
  OR s.payment_provider IS DISTINCT FROM p_provider OR s.provider_order_id IS DISTINCT FROM p_order
  OR s.quote_hash IS DISTINCT FROM r.quote_hash
  OR p.provider IS DISTINCT FROM p_provider OR p.provider_order_id IS DISTINCT FROM p_order
  OR p_order IS NULL OR p_capture IS NULL OR r.provider_order_id IS DISTINCT FROM p_order
  OR (r.provider_capture_id IS NOT NULL AND r.provider_capture_id<>p_capture)
  OR (p.provider_capture_id IS NOT NULL AND p.provider_capture_id<>p_capture)
  OR (r.provider='paypal' AND (r.phase<>'CAPTURE' OR r.provider_authorization_id IS DISTINCT FROM p.provider_authorization_id
     OR s.provider_authorization_id IS DISTINCT FROM p.provider_authorization_id OR p.provider_authorization_id IS NULL))
  OR (r.provider='razorpay' AND r.phase<>'CHECKOUT')
  OR p_amount IS DISTINCT FROM COALESCE((s.selected_product #>> '{authorizationContext,walletAmount}')::numeric,p.amount)
  OR p_currency IS DISTINCT FROM COALESCE(s.selected_product #>> '{authorizationContext,walletCurrency}',p.currency)
 THEN RAISE EXCEPTION 'RESERVATION_SETTLEMENT_IDENTITY_MISMATCH'; END IF;
 SELECT payload INTO e FROM session_payment_webhook_events WHERE payload_hash=p_evidence AND session_id=p_session
  AND provider=p_provider AND provider_link_id=p_order AND provider_payment_id=p_capture
  AND event_type=CASE WHEN p_provider='paypal' THEN 'PAYMENT.CAPTURE.COMPLETED' ELSE 'payment_link.paid' END;
 IF NOT FOUND THEN RAISE EXCEPTION 'VERIFIED_SETTLEMENT_EVIDENCE_REQUIRED'; END IF;
 IF p_provider='paypal' THEN
  IF e->>'event_type' IS DISTINCT FROM 'PAYMENT.CAPTURE.COMPLETED' OR e #>> '{resource,id}' IS DISTINCT FROM p_capture
   OR e #>> '{resource,supplementary_data,related_ids,order_id}' IS DISTINCT FROM p_order
   OR e #>> '{resource,supplementary_data,related_ids,authorization_id}' IS DISTINCT FROM p.provider_authorization_id
   OR (e #>> '{resource,amount,value}')::numeric IS DISTINCT FROM p.amount
   OR e #>> '{resource,amount,currency_code}' IS DISTINCT FROM p.currency
   OR e #>> '{resource,status}' IS DISTINCT FROM 'COMPLETED' THEN RAISE EXCEPTION 'VERIFIED_SETTLEMENT_EVIDENCE_MISMATCH'; END IF;
 ELSE
  IF e #>> '{payload,payment,entity,id}' IS DISTINCT FROM p_capture
   OR e #>> '{payload,payment_link,entity,id}' IS DISTINCT FROM p_order
   OR (e #>> '{payload,payment,entity,amount}')::numeric IS DISTINCT FROM p.amount*100
   OR e #>> '{payload,payment,entity,currency}' IS DISTINCT FROM p.currency
   OR e #>> '{payload,payment,entity,status}' IS DISTINCT FROM 'captured' THEN RAISE EXCEPTION 'VERIFIED_SETTLEMENT_EVIDENCE_MISMATCH'; END IF;
 END IF;
 SELECT * INTO l FROM wallet_spend_ledger WHERE session_id=p_session;
 IF FOUND THEN
  IF (l.wallet_id,l.amount,l.currency,l.provider,l.provider_link_id,l.provider_payment_id) IS DISTINCT FROM
    (p_wallet,p_amount,p_currency,p_provider,p_order,p_capture) OR r.state<>'COMMITTED' THEN RAISE EXCEPTION 'WALLET_LEDGER_PAYMENT_MISMATCH'; END IF;
  RETURN QUERY SELECT FALSE,l.ledger_id,w.spent_amount,w.total_authority-w.spent_amount-w.reserved_amount; RETURN;
 END IF;
 IF r.state NOT IN ('RESERVED','RECONCILIATION_REQUIRED') THEN RAISE EXCEPTION 'RESERVATION_NOT_SETTLEABLE'; END IF;
 INSERT INTO wallet_spend_ledger(session_id,wallet_id,amount,currency,provider,provider_link_id,provider_payment_id)
 VALUES(p_session,p_wallet,p_amount,p_currency,p_provider,p_order,p_capture) RETURNING * INTO l;
 UPDATE wallet_authority_reservations SET state='COMMITTED',provider_capture_id=p_capture WHERE session_id=p_session;
 UPDATE intent_wallets SET spent_amount=intent_wallets.spent_amount+p_amount,updated_at=NOW() WHERE wallet_id=p_wallet RETURNING * INTO w;
 RETURN QUERY SELECT TRUE,l.ledger_id,w.spent_amount,w.total_authority-w.spent_amount-w.reserved_amount;
END $$;
COMMIT;
