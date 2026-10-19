-- IntentLock V11.4 — Post-Purchase Guard
-- Refund requests are provider-idempotent and wallet authority restoration is replay-safe.

CREATE TABLE IF NOT EXISTS session_refunds (
  refund_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES purchase_sessions(session_id) ON DELETE RESTRICT,
  wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_capture_id TEXT NOT NULL,
  provider_refund_id TEXT UNIQUE,
  idempotency_key CHAR(64) NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  wallet_credit_amount NUMERIC(14,2) NOT NULL CHECK(wallet_credit_amount > 0),
  wallet_credit_currency TEXT NOT NULL CHECK(wallet_credit_currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL CHECK(status IN ('REQUESTED','PROVIDER_ACCEPTED','COMPLETED','FAILED','CANCELLED')),
  provider_status TEXT,
  evidence_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_session_refunds_session
ON session_refunds(session_id,created_at DESC);

CREATE TABLE IF NOT EXISTS wallet_refund_ledger (
  refund_ledger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id TEXT NOT NULL UNIQUE REFERENCES session_refunds(refund_id) ON DELETE RESTRICT,
  session_id TEXT NOT NULL REFERENCES purchase_sessions(session_id) ON DELETE RESTRICT,
  wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  provider TEXT NOT NULL,
  provider_refund_id TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_refund_ledger_session
ON wallet_refund_ledger(session_id,applied_at DESC);

CREATE OR REPLACE FUNCTION reserve_session_refund_v11_4(
  p_refund_id TEXT,
  p_session_id TEXT,
  p_wallet_id TEXT,
  p_provider TEXT,
  p_provider_capture_id TEXT,
  p_idempotency_key TEXT,
  p_reason TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_wallet_credit_amount NUMERIC,
  p_wallet_credit_currency TEXT
)
RETURNS SETOF session_refunds
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment session_payment_links%ROWTYPE;
  v_existing session_refunds%ROWTYPE;
  v_reserved NUMERIC;
BEGIN
  SELECT * INTO v_existing FROM session_refunds WHERE idempotency_key=p_idempotency_key LIMIT 1;
  IF FOUND THEN RETURN NEXT v_existing; RETURN; END IF;

  SELECT * INTO v_payment FROM session_payment_links
  WHERE session_id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_PAYMENT_NOT_FOUND'; END IF;
  IF v_payment.status<>'COMPLETED' THEN RAISE EXCEPTION 'PAYMENT_NOT_COMPLETED'; END IF;
  IF v_payment.provider<>p_provider THEN RAISE EXCEPTION 'REFUND_PROVIDER_MISMATCH'; END IF;
  IF v_payment.provider_capture_id IS DISTINCT FROM p_provider_capture_id THEN RAISE EXCEPTION 'REFUND_CAPTURE_MISMATCH'; END IF;
  IF UPPER(v_payment.currency)<>UPPER(p_currency) THEN RAISE EXCEPTION 'REFUND_CURRENCY_MISMATCH'; END IF;

  SELECT COALESCE(SUM(sr.amount),0) INTO v_reserved
  FROM session_refunds sr
  WHERE sr.session_id=p_session_id AND sr.status NOT IN ('FAILED','CANCELLED');
  IF v_reserved+p_amount>v_payment.amount THEN
    RAISE EXCEPTION 'REFUND_EXCEEDS_REMAINING_CAPTURE';
  END IF;

  INSERT INTO session_refunds(
    refund_id,session_id,wallet_id,provider,provider_capture_id,idempotency_key,
    reason,amount,currency,wallet_credit_amount,wallet_credit_currency,status
  ) VALUES(
    p_refund_id,p_session_id,p_wallet_id,p_provider,p_provider_capture_id,p_idempotency_key,
    p_reason,p_amount,UPPER(p_currency),p_wallet_credit_amount,UPPER(p_wallet_credit_currency),'REQUESTED'
  ) RETURNING * INTO v_existing;

  RETURN NEXT v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION apply_intent_wallet_refund_once_v11_4(
  p_refund_id TEXT,
  p_session_id TEXT,
  p_wallet_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_provider TEXT,
  p_provider_refund_id TEXT
)
RETURNS TABLE(
  applied BOOLEAN,
  refund_ledger_id UUID,
  spent_amount NUMERIC,
  remaining_authority NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet intent_wallets%ROWTYPE;
  v_original wallet_spend_ledger%ROWTYPE;
  v_existing wallet_refund_ledger%ROWTYPE;
  v_credited NUMERIC;
BEGIN
  SELECT * INTO v_wallet FROM intent_wallets w
  WHERE w.wallet_id=p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;

  SELECT * INTO v_existing FROM wallet_refund_ledger
  WHERE refund_id=p_refund_id OR provider_refund_id=p_provider_refund_id
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT FALSE,v_existing.refund_ledger_id,v_wallet.spent_amount,
      v_wallet.total_authority-v_wallet.spent_amount;
    RETURN;
  END IF;

  SELECT * INTO v_original FROM wallet_spend_ledger
  WHERE session_id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORIGINAL_WALLET_SPEND_NOT_FOUND'; END IF;
  IF v_original.wallet_id<>p_wallet_id THEN RAISE EXCEPTION 'REFUND_WALLET_MISMATCH'; END IF;
  IF UPPER(v_original.currency)<>UPPER(p_currency) THEN RAISE EXCEPTION 'REFUND_WALLET_CURRENCY_MISMATCH'; END IF;

  SELECT COALESCE(SUM(wrl.amount),0) INTO v_credited
  FROM wallet_refund_ledger wrl WHERE wrl.session_id=p_session_id;
  IF v_credited+p_amount>v_original.amount THEN
    RAISE EXCEPTION 'REFUND_EXCEEDS_ORIGINAL_WALLET_DEBIT';
  END IF;

  INSERT INTO wallet_refund_ledger(
    refund_id,session_id,wallet_id,amount,currency,provider,provider_refund_id
  ) VALUES(
    p_refund_id,p_session_id,p_wallet_id,p_amount,UPPER(p_currency),p_provider,p_provider_refund_id
  ) RETURNING * INTO v_existing;

  UPDATE intent_wallets AS w
  SET spent_amount=GREATEST(0,w.spent_amount-p_amount),updated_at=NOW()
  WHERE w.wallet_id=p_wallet_id
  RETURNING w.* INTO v_wallet;

  RETURN QUERY SELECT TRUE,v_existing.refund_ledger_id,v_wallet.spent_amount,
    v_wallet.total_authority-v_wallet.spent_amount;
END;
$$;
