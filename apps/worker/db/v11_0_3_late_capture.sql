-- Verified PayPal reconciliation only. The original V11 function remains unchanged.
-- No data backfill, expiry changes, or session state changes.
CREATE OR REPLACE FUNCTION reconcile_paypal_wallet_spend_once_v11_0_3(
  p_session_id TEXT, p_wallet_id TEXT, p_amount NUMERIC, p_currency TEXT,
  p_provider TEXT, p_provider_order_id TEXT, p_provider_payment_id TEXT,
  p_verified_payload_hash TEXT
)
RETURNS TABLE(applied BOOLEAN, ledger_id UUID, spent_amount NUMERIC, remaining_authority NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet intent_wallets%ROWTYPE;
  v_ledger wallet_spend_ledger%ROWTYPE;
  v_payment session_payment_links%ROWTYPE;
  v_session purchase_sessions%ROWTYPE;
  v_evidence JSONB;
BEGIN
  SELECT * INTO v_wallet FROM intent_wallets w WHERE w.wallet_id=p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;
  SELECT * INTO v_payment FROM session_payment_links WHERE session_id=p_session_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_PAYMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_session FROM purchase_sessions WHERE session_id=p_session_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;

  IF p_provider IS DISTINCT FROM 'paypal'
     OR v_payment.provider IS DISTINCT FROM 'paypal'
     OR v_session.payment_provider IS DISTINCT FROM 'paypal'
     OR v_payment.wallet_id IS DISTINCT FROM p_wallet_id
     OR v_session.wallet_id IS DISTINCT FROM p_wallet_id
     OR p_provider_order_id IS NULL OR p_provider_payment_id IS NULL
     OR v_payment.provider_order_id IS DISTINCT FROM p_provider_order_id
     OR v_session.provider_order_id IS DISTINCT FROM p_provider_order_id
     OR v_payment.provider_authorization_id IS NULL
     OR v_session.provider_authorization_id IS DISTINCT FROM v_payment.provider_authorization_id
     OR (v_payment.provider_capture_id IS NOT NULL AND v_payment.provider_capture_id<>p_provider_payment_id)
     OR (v_session.provider_capture_id IS NOT NULL AND v_session.provider_capture_id<>p_provider_payment_id)
     OR p_amount IS NULL OR p_amount<=0 OR p_currency IS NULL
     OR p_amount IS DISTINCT FROM COALESCE((v_session.selected_product #>> '{authorizationContext,walletAmount}')::numeric,v_payment.amount)
     OR UPPER(p_currency) IS DISTINCT FROM UPPER(COALESCE(v_session.selected_product #>> '{authorizationContext,walletCurrency}',v_payment.currency)) THEN
    RAISE EXCEPTION 'PAYMENT_IDENTITY_MISMATCH';
  END IF;

  -- Only ingress records persisted after successful PayPal signature verification qualify.
  SELECT payload INTO v_evidence FROM session_payment_webhook_events
  WHERE payload_hash=p_verified_payload_hash AND session_id=p_session_id
    AND provider='paypal' AND event_type='PAYMENT.CAPTURE.COMPLETED'
    AND provider_link_id=p_provider_order_id AND provider_payment_id=p_provider_payment_id;
  IF NOT FOUND OR v_evidence->>'event_type' IS DISTINCT FROM 'PAYMENT.CAPTURE.COMPLETED'
     OR v_evidence #>> '{resource,id}' IS DISTINCT FROM p_provider_payment_id
     OR v_evidence #>> '{resource,supplementary_data,related_ids,order_id}' IS DISTINCT FROM p_provider_order_id
     OR v_evidence #>> '{resource,supplementary_data,related_ids,authorization_id}' IS DISTINCT FROM v_payment.provider_authorization_id
     OR (v_evidence #>> '{resource,amount,value}')::numeric IS DISTINCT FROM v_payment.amount
     OR UPPER(v_evidence #>> '{resource,amount,currency_code}') IS DISTINCT FROM UPPER(v_payment.currency) THEN
    RAISE EXCEPTION 'VERIFIED_PAYPAL_CAPTURE_MISMATCH';
  END IF;

  -- Existing matching ledger is authoritative, including after expiry/revocation.
  SELECT * INTO v_ledger FROM wallet_spend_ledger WHERE session_id=p_session_id;
  IF FOUND THEN
    IF v_ledger.wallet_id IS DISTINCT FROM p_wallet_id
       OR v_ledger.amount IS DISTINCT FROM p_amount
       OR UPPER(v_ledger.currency) IS DISTINCT FROM UPPER(p_currency)
       OR v_ledger.provider IS DISTINCT FROM p_provider
       OR v_ledger.provider_link_id IS DISTINCT FROM p_provider_order_id
       OR v_ledger.provider_payment_id IS DISTINCT FROM p_provider_payment_id THEN
      RAISE EXCEPTION 'WALLET_LEDGER_PAYMENT_MISMATCH';
    END IF;
    RETURN QUERY SELECT FALSE,v_ledger.ledger_id,v_wallet.spent_amount,v_wallet.total_authority-v_wallet.spent_amount;
    RETURN;
  END IF;

  -- Use append-only server-recorded history, never mutable updated_at or webhook arrival time.
  -- Require BOTH authorization and capture request before expiry, with a bound authority
  -- recheck/consumption between them. Missing history is not permission to debit.
  IF NOT EXISTS (
    SELECT 1 FROM purchase_session_events a
    JOIN purchase_session_events c ON c.session_id=a.session_id
    JOIN purchase_session_events r ON r.session_id=a.session_id
    WHERE a.session_id=p_session_id AND a.event_type='PAYPAL_AUTHORIZED'
      AND c.event_type IN ('PAYPAL_CAPTURE_INITIATED','PAYPAL_CAPTURE_REQUESTED')
      AND a.payload->>'providerOrderId'=p_provider_order_id
      AND a.payload->>'providerAuthorizationId'=v_payment.provider_authorization_id
      AND (a.payload->>'amount')::numeric=v_payment.amount
      AND UPPER(a.payload->>'currency')=UPPER(v_payment.currency)
      AND a.payload->>'quoteHash'=v_payment.quote_hash
      AND c.payload->>'providerAuthorizationId'=v_payment.provider_authorization_id
      AND ((c.event_type='PAYPAL_CAPTURE_REQUESTED' AND c.payload->>'providerCaptureId'=p_provider_payment_id)
           OR (c.event_type='PAYPAL_CAPTURE_INITIATED' AND c.payload->>'providerOrderId'=p_provider_order_id))
      AND (c.payload->>'amount')::numeric=v_payment.amount
      AND UPPER(c.payload->>'currency')=UPPER(v_payment.currency)
      AND r.event_type IN ('PAYMENT_AUTHORITY_RECHECK_ALLOWED','ONE_TIME_AUTHORIZATION_CONSUMED')
      AND r.payload->>'quoteHash'=v_payment.quote_hash
      AND (r.payload->>'amount')::numeric=p_amount
      AND UPPER(r.payload->>'currency')=UPPER(p_currency)
      AND (r.event_type<>'ONE_TIME_AUTHORIZATION_CONSUMED'
           OR r.payload->>'authorizationId'=v_payment.authorization_id)
      AND v_payment.created_at<=a.occurred_at
      AND a.occurred_at<=r.occurred_at AND r.occurred_at<=c.occurred_at
      AND a.occurred_at<v_wallet.valid_until AND c.occurred_at<v_wallet.valid_until
      AND c.occurred_at<=NOW()
  ) THEN RAISE EXCEPTION 'PAYPAL_HISTORICAL_AUTHORITY_INVALID'; END IF;

  IF v_wallet.status<>'ACTIVE' THEN RAISE EXCEPTION 'WALLET_NOT_ACTIVE'; END IF;
  IF UPPER(v_wallet.currency)<>UPPER(p_currency) THEN RAISE EXCEPTION 'WALLET_CURRENCY_MISMATCH'; END IF;
  IF v_wallet.spent_amount+p_amount>v_wallet.total_authority THEN
    RAISE EXCEPTION 'WALLET_TOTAL_AUTHORITY_EXCEEDED';
  END IF;

  INSERT INTO wallet_spend_ledger(session_id,wallet_id,amount,currency,provider,provider_link_id,provider_payment_id)
  VALUES(p_session_id,p_wallet_id,p_amount,UPPER(p_currency),p_provider,p_provider_order_id,p_provider_payment_id)
  RETURNING * INTO v_ledger;
  UPDATE intent_wallets AS w SET spent_amount=w.spent_amount+p_amount,updated_at=NOW()
  WHERE w.wallet_id=p_wallet_id RETURNING w.* INTO v_wallet;
  RETURN QUERY SELECT TRUE,v_ledger.ledger_id,v_wallet.spent_amount,v_wallet.total_authority-v_wallet.spent_amount;
END;
$$;
