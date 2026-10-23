-- Additive versioned migration. No mapping seeds, backfill or financial updates.
BEGIN;
ALTER TABLE session_payment_links ADD COLUMN expected_recipient JSONB;
CREATE TABLE paypal_recipient_observations (
 observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id TEXT NOT NULL REFERENCES purchase_sessions(session_id),
 stage TEXT NOT NULL CHECK(stage IN ('ORDER','PRE_AUTHORIZE','AUTHORIZE','PRE_CAPTURE','CAPTURE','SETTLEMENT','RECOVERY')),
 environment TEXT NOT NULL CHECK(environment IN ('sandbox','live')),
 expected_fingerprint TEXT NOT NULL,
 order_id TEXT NOT NULL,authorization_id TEXT,capture_id TEXT,payload_hash TEXT,
 raw JSONB NOT NULL,
 recipient_contradiction BOOLEAN NOT NULL DEFAULT FALSE,
 verified BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX paypal_recipient_observations_session ON paypal_recipient_observations(session_id,stage,created_at DESC);

CREATE FUNCTION guard_expected_recipient_v11_4_6() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bound JSONB;
BEGIN
 IF TG_OP='UPDATE' AND OLD.expected_recipient IS NOT NULL AND NEW.expected_recipient IS DISTINCT FROM OLD.expected_recipient THEN RAISE EXCEPTION 'RECIPIENT_BINDING_IMMUTABLE'; END IF;
 IF NEW.expected_recipient IS NOT NULL AND (TG_OP='INSERT' OR OLD.expected_recipient IS NULL) THEN
  IF TG_OP='UPDATE' AND OLD.provider_order_id IS NOT NULL THEN RAISE EXCEPTION 'LEGACY_RECIPIENT_CANNOT_BE_INVENTED'; END IF;
  SELECT selected_product #> '{authorizationContext,recipient}' INTO bound FROM purchase_sessions WHERE session_id=NEW.session_id AND wallet_id=NEW.wallet_id;
  IF bound IS NULL OR bound IS DISTINCT FROM NEW.expected_recipient OR NEW.provider<>'paypal'
   OR bound->>'version' IS DISTINCT FROM 'intentlock-recipient-v1'
   OR bound->>'provider' IS DISTINCT FROM 'paypal' OR bound->>'integration' IS DISTINCT FROM 'DIRECT_MERCHANT'
   OR bound->>'environment' IS NULL OR bound->>'environment' NOT IN ('sandbox','live')
   OR bound->>'paypalMerchantId' IS NULL OR bound->>'paypalMerchantId' !~ '^[2-9A-HJ-NP-Z]{13}$'
   OR bound->>'fingerprint' IS NULL OR bound->>'fingerprint' !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'RECIPIENT_BINDING_INVALID'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER session_expected_recipient_guard BEFORE INSERT OR UPDATE ON session_payment_links FOR EACH ROW EXECUTE FUNCTION guard_expected_recipient_v11_4_6();

CREATE FUNCTION recipient_observation_valid_v11_4_6(o paypal_recipient_observations)
 RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE p session_payment_links%ROWTYPE; b JSONB; u JSONB; a JSONB; c JSONB; event JSONB; merchant TEXT;
BEGIN
 SELECT * INTO p FROM session_payment_links WHERE session_id=o.session_id;
 b=p.expected_recipient;merchant=b->>'paypalMerchantId';
 IF b IS NULL OR o.environment IS DISTINCT FROM b->>'environment' OR o.expected_fingerprint IS DISTINCT FROM b->>'fingerprint'
  OR p.provider<>'paypal' OR p.provider_order_id IS DISTINCT FROM o.order_id
  OR o.raw #>> '{order,id}' IS DISTINCT FROM o.order_id OR o.raw #>> '{order,intent}' IS DISTINCT FROM 'AUTHORIZE'
  OR jsonb_typeof(o.raw #> '{order,purchase_units}') IS DISTINCT FROM 'array'
  OR jsonb_array_length(o.raw #> '{order,purchase_units}')<>1 THEN RETURN FALSE; END IF;
 u=o.raw #> '{order,purchase_units,0}';
 IF o.stage='ORDER' AND (o.raw #>> '{order,status}' IS NULL OR o.raw #>> '{order,status}' NOT IN ('CREATED','SAVED','PAYER_ACTION_REQUIRED','APPROVED')) THEN RETURN FALSE; END IF;
 IF o.stage='PRE_AUTHORIZE' AND o.raw #>> '{order,status}' IS DISTINCT FROM 'APPROVED' THEN RETURN FALSE; END IF;
 IF o.stage IN ('AUTHORIZE','PRE_CAPTURE','CAPTURE','SETTLEMENT') AND o.raw #>> '{order,status}' IS DISTINCT FROM 'COMPLETED' THEN RETURN FALSE; END IF;
 IF u->>'custom_id' IS DISTINCT FROM o.session_id OR u->>'reference_id' IS DISTINCT FROM o.session_id
  OR u #>> '{payee,merchant_id}' IS DISTINCT FROM merchant OR (u #>> '{amount,value}')::numeric IS DISTINCT FROM p.amount
  OR u #>> '{amount,currency_code}' IS DISTINCT FROM p.currency THEN RETURN FALSE; END IF;
 IF o.stage IN ('ORDER','PRE_AUTHORIZE') AND (jsonb_array_length(COALESCE(u #> '{payments,authorizations}','[]'))>0
  OR jsonb_array_length(COALESCE(u #> '{payments,captures}','[]'))>0) THEN RETURN FALSE; END IF;
 IF o.raw #> '{apiResponse,payee}' IS NOT NULL AND o.raw #>> '{apiResponse,payee,merchant_id}' IS DISTINCT FROM merchant THEN RETURN FALSE; END IF;
 IF o.raw #> '{webhook,resource,payee}' IS NOT NULL AND o.raw #>> '{webhook,resource,payee,merchant_id}' IS DISTINCT FROM merchant THEN RETURN FALSE; END IF;
 IF o.raw #> '{apiResponse,purchase_units}' IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.raw #> '{apiResponse,purchase_units}') x
  WHERE x ? 'payee' AND x #>> '{payee,merchant_id}' IS DISTINCT FROM merchant) THEN RETURN FALSE; END IF;
 IF o.stage IN ('AUTHORIZE','PRE_CAPTURE','CAPTURE','SETTLEMENT','RECOVERY') THEN
  a=o.raw->'authorization';
  IF o.authorization_id IS NULL OR a->>'id' IS DISTINCT FROM o.authorization_id
   OR (p.provider_authorization_id IS NOT NULL AND p.provider_authorization_id<>o.authorization_id)
   OR (a #>> '{amount,value}')::numeric IS DISTINCT FROM p.amount OR a #>> '{amount,currency_code}' IS DISTINCT FROM p.currency
   OR (a ? 'payee' AND a #>> '{payee,merchant_id}' IS DISTINCT FROM merchant)
   OR (a #>> '{supplementary_data,related_ids,order_id}' IS NOT NULL AND a #>> '{supplementary_data,related_ids,order_id}'<>o.order_id)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(u #> '{payments,authorizations}','[]')) x
     WHERE x->>'id'=o.authorization_id AND (x #>> '{amount,value}')::numeric=p.amount AND x #>> '{amount,currency_code}'=p.currency)
  THEN RETURN FALSE; END IF;
  IF o.stage IN ('AUTHORIZE','PRE_CAPTURE') AND a->>'status' IS DISTINCT FROM 'CREATED' THEN RETURN FALSE; END IF;
 END IF;
 IF o.stage IN ('CAPTURE','SETTLEMENT') THEN
  c=o.raw->'capture';
  IF o.capture_id IS NULL OR c->>'id' IS DISTINCT FROM o.capture_id
   OR (p.provider_capture_id IS NOT NULL AND p.provider_capture_id<>o.capture_id)
   OR (c #>> '{amount,value}')::numeric IS DISTINCT FROM p.amount OR c #>> '{amount,currency_code}' IS DISTINCT FROM p.currency
   OR c #>> '{supplementary_data,related_ids,order_id}' IS DISTINCT FROM o.order_id
   OR c #>> '{supplementary_data,related_ids,authorization_id}' IS DISTINCT FROM o.authorization_id
   OR (c ? 'payee' AND c #>> '{payee,merchant_id}' IS DISTINCT FROM merchant)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(u #> '{payments,captures}','[]')) x
     WHERE x->>'id'=o.capture_id AND (x #>> '{amount,value}')::numeric=p.amount AND x #>> '{amount,currency_code}'=p.currency)
  THEN RETURN FALSE; END IF;
 END IF;
 IF o.stage='SETTLEMENT' THEN
  event=o.raw->'webhook';
  IF event->>'event_type' IS DISTINCT FROM 'PAYMENT.CAPTURE.COMPLETED'
   OR event #>> '{resource,id}' IS DISTINCT FROM o.capture_id
   OR event #>> '{resource,status}' IS DISTINCT FROM 'COMPLETED' OR c->>'status' IS DISTINCT FROM 'COMPLETED'
   OR event #>> '{resource,supplementary_data,related_ids,order_id}' IS DISTINCT FROM o.order_id
   OR event #>> '{resource,supplementary_data,related_ids,authorization_id}' IS DISTINCT FROM o.authorization_id
   OR (event #>> '{resource,amount,value}')::numeric IS DISTINCT FROM p.amount
   OR event #>> '{resource,amount,currency_code}' IS DISTINCT FROM p.currency
   OR (event->'resource' ? 'payee' AND event #>> '{resource,payee,merchant_id}' IS DISTINCT FROM merchant)
   OR NOT EXISTS(SELECT 1 FROM session_payment_webhook_events e WHERE e.payload_hash=o.payload_hash AND e.session_id=o.session_id
    AND e.provider='paypal' AND e.event_type='PAYMENT.CAPTURE.COMPLETED' AND e.payload=event
    AND e.provider_link_id=o.order_id AND e.provider_payment_id=o.capture_id)
  THEN RETURN FALSE; END IF;
 END IF;
 RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
CREATE FUNCTION recipient_contradiction_v11_4_6(p_raw JSONB,p_merchant TEXT) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item JSONB;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(jsonb_build_array(p_raw #> '{order,purchase_units,0,payee}',p_raw #> '{authorization,payee}',p_raw #> '{capture,payee}',p_raw #> '{apiResponse,payee}',p_raw #> '{webhook,resource,payee}')) LOOP
  IF item->>'merchant_id' IS NOT NULL AND item->>'merchant_id' IS DISTINCT FROM p_merchant THEN RETURN TRUE; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_raw #> '{apiResponse,purchase_units}','[]'::jsonb)||COALESCE(p_raw #> '{order,purchase_units}','[]'::jsonb)) LOOP
  IF item #>> '{payee,merchant_id}' IS NOT NULL AND item #>> '{payee,merchant_id}' IS DISTINCT FROM p_merchant THEN RETURN TRUE; END IF;
 END LOOP;
 RETURN FALSE;
EXCEPTION WHEN OTHERS THEN RETURN TRUE;
END $$;
CREATE FUNCTION assert_no_recipient_contradiction_v11_4_6(p_session TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM paypal_recipient_observations WHERE session_id=p_session AND recipient_contradiction) THEN
  RAISE EXCEPTION 'PAYPAL_RECIPIENT_CONTRADICTION_REQUIRES_INVESTIGATION';
 END IF;
END $$;
CREATE FUNCTION guard_recipient_observation_v11_4_6() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RECIPIENT_EVIDENCE_IMMUTABLE'; END IF;
 NEW.recipient_contradiction=recipient_contradiction_v11_4_6(NEW.raw,(SELECT expected_recipient->>'paypalMerchantId' FROM session_payment_links WHERE session_id=NEW.session_id));
 IF TG_OP='UPDATE' AND (OLD.verified OR (to_jsonb(NEW)-'verified') IS DISTINCT FROM (to_jsonb(OLD)-'verified')) THEN RAISE EXCEPTION 'RECIPIENT_EVIDENCE_IMMUTABLE'; END IF;
 IF NEW.verified AND NOT recipient_observation_valid_v11_4_6(NEW) THEN RAISE EXCEPTION 'RECIPIENT_EVIDENCE_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipient_observation_integrity BEFORE INSERT OR UPDATE OR DELETE ON paypal_recipient_observations FOR EACH ROW EXECUTE FUNCTION guard_recipient_observation_v11_4_6();

ALTER FUNCTION begin_wallet_provider_operation_v11_4_5(TEXT,TEXT,TEXT) RENAME TO begin_wallet_provider_operation_pre_recipient_v11_4_6;
CREATE FUNCTION begin_wallet_provider_operation_v11_4_5(p_session TEXT,p_quote TEXT,p_phase TEXT)
 RETURNS SETOF wallet_authority_reservations LANGUAGE plpgsql AS $$
DECLARE p session_payment_links%ROWTYPE;
BEGIN
 SELECT * INTO p FROM session_payment_links WHERE session_id=p_session;
 IF p.provider='paypal' THEN
  PERFORM assert_no_recipient_contradiction_v11_4_6(p_session);
  IF p.expected_recipient IS NULL THEN RAISE EXCEPTION 'VERIFIED_RECIPIENT_MAPPING_REQUIRED'; END IF;
  IF p_phase IN ('AUTHORIZE','CAPTURE') AND NOT EXISTS(SELECT 1 FROM paypal_recipient_observations o
   WHERE o.session_id=p_session AND o.stage=CASE WHEN p_phase='AUTHORIZE' THEN 'PRE_AUTHORIZE' ELSE 'PRE_CAPTURE' END
   AND o.verified AND o.created_at>NOW()-INTERVAL '2 minutes' AND recipient_observation_valid_v11_4_6(o)) THEN RAISE EXCEPTION 'VERIFIED_PROVIDER_RECIPIENT_REQUIRED'; END IF;
 END IF;
 RETURN QUERY SELECT * FROM begin_wallet_provider_operation_pre_recipient_v11_4_6(p_session,p_quote,p_phase);
END $$;
ALTER FUNCTION settle_wallet_reservation_v11_4_5(TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT) RENAME TO settle_wallet_reservation_pre_recipient_v11_4_6;
CREATE FUNCTION settle_wallet_reservation_v11_4_5(p_session TEXT,p_wallet TEXT,p_amount NUMERIC,p_currency TEXT,p_provider TEXT,p_order TEXT,p_capture TEXT,p_evidence TEXT)
 RETURNS TABLE(applied BOOLEAN,ledger_id UUID,spent_amount NUMERIC,remaining_authority NUMERIC) LANGUAGE plpgsql AS $$
DECLARE b JSONB;
BEGIN
 PERFORM 1 FROM intent_wallets WHERE wallet_id=p_wallet FOR UPDATE;
 IF p_provider='paypal' THEN
  PERFORM assert_no_recipient_contradiction_v11_4_6(p_session);
  SELECT expected_recipient INTO b FROM session_payment_links WHERE session_id=p_session;
  IF b IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM wallet_spend_ledger WHERE session_id=p_session) THEN RAISE EXCEPTION 'LEGACY_RECIPIENT_RECONCILIATION_REQUIRED'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM paypal_recipient_observations o WHERE o.session_id=p_session AND o.stage='SETTLEMENT'
   AND o.payload_hash=p_evidence AND o.order_id=p_order AND o.capture_id=p_capture AND o.verified AND recipient_observation_valid_v11_4_6(o)) THEN RAISE EXCEPTION 'VERIFIED_PROVIDER_RECIPIENT_REQUIRED'; END IF;
 END IF;
 RETURN QUERY SELECT * FROM settle_wallet_reservation_pre_recipient_v11_4_6(p_session,p_wallet,p_amount,p_currency,p_provider,p_order,p_capture,p_evidence);
END $$;
ALTER FUNCTION confirm_wallet_provider_operation_v11_4_5(TEXT,TEXT,TEXT,TEXT,TEXT) RENAME TO confirm_wallet_provider_operation_pre_recipient_v11_4_6;
CREATE FUNCTION confirm_wallet_provider_operation_v11_4_5(p_session TEXT,p_phase TEXT,p_order TEXT,p_auth TEXT,p_capture TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE p session_payment_links%ROWTYPE;
BEGIN
 IF EXISTS(SELECT 1 FROM wallet_authority_reservations WHERE session_id=p_session AND state='COMMITTED') THEN RETURN; END IF;
 SELECT * INTO p FROM session_payment_links WHERE session_id=p_session;
 IF p.provider='paypal' THEN PERFORM assert_no_recipient_contradiction_v11_4_6(p_session); END IF;
 IF p.provider='paypal' AND NOT EXISTS(SELECT 1 FROM paypal_recipient_observations o WHERE o.session_id=p_session
  AND o.stage=CASE p_phase WHEN 'CHECKOUT' THEN 'ORDER' WHEN 'AUTHORIZE' THEN 'AUTHORIZE' ELSE 'CAPTURE' END
  AND o.order_id=p_order AND (p_auth IS NULL OR o.authorization_id=p_auth) AND (p_capture IS NULL OR o.capture_id=p_capture)
  AND o.verified AND recipient_observation_valid_v11_4_6(o)) THEN RAISE EXCEPTION 'VERIFIED_PROVIDER_RECIPIENT_REQUIRED'; END IF;
 PERFORM confirm_wallet_provider_operation_pre_recipient_v11_4_6(p_session,p_phase,p_order,p_auth,p_capture);
END $$;
ALTER FUNCTION recover_wallet_authorization_v11_4_5(TEXT,JSONB,JSONB) RENAME TO recover_wallet_authorization_pre_recipient_v11_4_6;
CREATE FUNCTION recover_wallet_authorization_v11_4_5(p_session TEXT,p_order JSONB,p_auth JSONB) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
 PERFORM assert_no_recipient_contradiction_v11_4_6(p_session);
 IF NOT EXISTS(SELECT 1 FROM paypal_recipient_observations o WHERE o.session_id=p_session AND o.stage='RECOVERY' AND o.verified
  AND o.raw->'order'=p_order AND o.raw->'authorization'=p_auth AND o.created_at>NOW()-INTERVAL '2 minutes' AND recipient_observation_valid_v11_4_6(o))
 THEN RAISE EXCEPTION 'VERIFIED_PROVIDER_RECIPIENT_REQUIRED'; END IF;
 RETURN recover_wallet_authorization_pre_recipient_v11_4_6(p_session,p_order,p_auth);
END $$;
ALTER FUNCTION release_voided_wallet_reservation_v11_4_5(TEXT,JSONB,JSONB) RENAME TO release_voided_wallet_reservation_pre_recipient_v11_4_6;
CREATE FUNCTION release_voided_wallet_reservation_v11_4_5(p_session TEXT,p_order JSONB,p_auth JSONB) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
 PERFORM assert_no_recipient_contradiction_v11_4_6(p_session);
 IF NOT EXISTS(SELECT 1 FROM paypal_recipient_observations o WHERE o.session_id=p_session AND o.stage='RECOVERY' AND o.verified
  AND o.raw->'order'=p_order AND o.raw->'authorization'=p_auth AND o.created_at>NOW()-INTERVAL '2 minutes' AND recipient_observation_valid_v11_4_6(o))
 THEN RAISE EXCEPTION 'VERIFIED_PROVIDER_RECIPIENT_REQUIRED'; END IF;
 RETURN release_voided_wallet_reservation_pre_recipient_v11_4_6(p_session,p_order,p_auth);
END $$;
ALTER FUNCTION release_denied_wallet_capture_v11_4_5(TEXT,TEXT) RENAME TO release_denied_wallet_capture_pre_recipient_v11_4_6;
CREATE FUNCTION release_denied_wallet_capture_v11_4_5(p_session TEXT,p_hash TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM wallet_authority_reservations WHERE session_id=p_session AND state IN ('RESERVED','RECONCILIATION_REQUIRED')) THEN RETURN FALSE; END IF;
 PERFORM assert_no_recipient_contradiction_v11_4_6(p_session);
 IF NOT EXISTS(SELECT 1 FROM paypal_recipient_observations o WHERE o.session_id=p_session AND o.stage='CAPTURE'
  AND o.payload_hash=p_hash AND o.verified AND recipient_observation_valid_v11_4_6(o)) THEN RAISE EXCEPTION 'VERIFIED_PROVIDER_RECIPIENT_REQUIRED'; END IF;
 RETURN release_denied_wallet_capture_pre_recipient_v11_4_6(p_session,p_hash);
END $$;
COMMIT;
