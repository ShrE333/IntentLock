-- IntentLock V10.6
-- PurchaseSession -> Razorpay -> verified webhook -> wallet debit -> proof receipt

ALTER TABLE purchase_sessions
  ADD COLUMN IF NOT EXISTS quote_hash TEXT,
  ADD COLUMN IF NOT EXISTS payment_link_url TEXT,
  ADD COLUMN IF NOT EXISTS payment_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS captured_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS captured_currency TEXT,
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_session_payment_key
ON purchase_sessions(payment_idempotency_key)
WHERE payment_idempotency_key IS NOT NULL;

ALTER TABLE wallet_one_time_authorizations
  ADD COLUMN IF NOT EXISTS consumed_by_session_id TEXT
    REFERENCES purchase_sessions(session_id)
    ON DELETE SET NULL;


CREATE TABLE IF NOT EXISTS session_audit_mirrors (
  session_event_id TEXT PRIMARY KEY
    REFERENCES purchase_session_events(event_id)
    ON DELETE CASCADE,

  session_id TEXT NOT NULL
    REFERENCES purchase_sessions(session_id)
    ON DELETE CASCADE,

  audit_event_id UUID NOT NULL UNIQUE,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_audit_mirrors_session
ON session_audit_mirrors(session_id);

CREATE TABLE IF NOT EXISTS session_payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  session_id TEXT NOT NULL UNIQUE
    REFERENCES purchase_sessions(session_id)
    ON DELETE RESTRICT,

  wallet_id TEXT NOT NULL
    REFERENCES intent_wallets(wallet_id)
    ON DELETE RESTRICT,

  authorization_id TEXT,
  quote_hash CHAR(64) NOT NULL,

  idempotency_key TEXT NOT NULL UNIQUE,

  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_link_id TEXT UNIQUE,
  reference_id TEXT UNIQUE,
  short_url TEXT,

  amount NUMERIC(14,2) NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL CHECK(currency = 'INR'),

  status TEXT NOT NULL DEFAULT 'CREATING',
  expires_at TIMESTAMPTZ,

  provider_payment_id TEXT,
  captured_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_payment_links_provider
ON session_payment_links(provider_link_id);

CREATE TABLE IF NOT EXISTS session_payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload_hash CHAR(64) NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  provider_link_id TEXT,
  provider_payment_id TEXT,
  session_id TEXT REFERENCES purchase_sessions(session_id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_spend_ledger (
  ledger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  session_id TEXT NOT NULL UNIQUE
    REFERENCES purchase_sessions(session_id)
    ON DELETE RESTRICT,

  wallet_id TEXT NOT NULL
    REFERENCES intent_wallets(wallet_id)
    ON DELETE RESTRICT,

  amount NUMERIC(14,2) NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL CHECK(currency = 'INR'),

  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_link_id TEXT,
  provider_payment_id TEXT,

  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_spend_ledger_wallet
ON wallet_spend_ledger(wallet_id, applied_at DESC);

CREATE TABLE IF NOT EXISTS proof_receipts (
  receipt_id TEXT PRIMARY KEY,

  session_id TEXT NOT NULL UNIQUE
    REFERENCES purchase_sessions(session_id)
    ON DELETE RESTRICT,

  wallet_id TEXT NOT NULL
    REFERENCES intent_wallets(wallet_id)
    ON DELETE RESTRICT,

  payload JSONB NOT NULL,

  proof_hash CHAR(64) NOT NULL UNIQUE,
  proof_signature CHAR(64) NOT NULL,

  evidence_audit_head_hash CHAR(64),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Consume the exact one-time authorization once.
CREATE OR REPLACE FUNCTION consume_wallet_one_time_authorization(
  p_authorization_id TEXT,
  p_wallet_id TEXT,
  p_session_id TEXT,
  p_quote_hash TEXT,
  p_amount NUMERIC
)
RETURNS TABLE(
  consumed BOOLEAN,
  reason TEXT,
  token_hash TEXT,
  authorization_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_auth wallet_one_time_authorizations%ROWTYPE;
BEGIN
  SELECT *
  INTO v_auth
  FROM wallet_one_time_authorizations
  WHERE authorization_id = p_authorization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'AUTHORIZATION_NOT_FOUND', NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_auth.wallet_id <> p_wallet_id THEN
    RETURN QUERY SELECT FALSE, 'AUTHORIZATION_WALLET_MISMATCH', NULL::TEXT, v_auth.expires_at;
    RETURN;
  END IF;

  IF v_auth.quote_hash <> p_quote_hash THEN
    RETURN QUERY SELECT FALSE, 'AUTHORIZATION_QUOTE_MISMATCH', NULL::TEXT, v_auth.expires_at;
    RETURN;
  END IF;

  IF v_auth.amount <> p_amount THEN
    RETURN QUERY SELECT FALSE, 'AUTHORIZATION_AMOUNT_MISMATCH', NULL::TEXT, v_auth.expires_at;
    RETURN;
  END IF;

  IF v_auth.expires_at <= NOW() THEN
    RETURN QUERY SELECT FALSE, 'AUTHORIZATION_EXPIRED', NULL::TEXT, v_auth.expires_at;
    RETURN;
  END IF;

  IF v_auth.consumed_at IS NOT NULL THEN
    IF v_auth.consumed_by_session_id = p_session_id THEN
      RETURN QUERY SELECT TRUE, 'ALREADY_CONSUMED_BY_THIS_SESSION', v_auth.token_hash, v_auth.expires_at;
    ELSE
      RETURN QUERY SELECT FALSE, 'AUTHORIZATION_ALREADY_CONSUMED', NULL::TEXT, v_auth.expires_at;
    END IF;
    RETURN;
  END IF;

  UPDATE wallet_one_time_authorizations
  SET
    consumed_at = NOW(),
    consumed_by_session_id = p_session_id
  WHERE authorization_id = p_authorization_id;

  RETURN QUERY
  SELECT TRUE, 'CONSUMED', v_auth.token_hash, v_auth.expires_at;
END;
$$;

-- Only release an authorization if this session consumed it and no payment link
-- has been successfully persisted. Used only when provider creation fails.
CREATE OR REPLACE FUNCTION release_wallet_one_time_authorization(
  p_authorization_id TEXT,
  p_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE wallet_one_time_authorizations
  SET
    consumed_at = NULL,
    consumed_by_session_id = NULL
  WHERE authorization_id = p_authorization_id
    AND consumed_by_session_id = p_session_id
    AND NOT EXISTS (
      SELECT 1
      FROM session_payment_links spl
      WHERE spl.session_id = p_session_id
        AND spl.provider_link_id IS NOT NULL
    );

  RETURN FOUND;
END;
$$;

-- Atomic, replay-safe wallet debit.
CREATE OR REPLACE FUNCTION apply_intent_wallet_spend_once(
  p_session_id TEXT,
  p_wallet_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_provider_link_id TEXT,
  p_provider_payment_id TEXT
)
RETURNS TABLE(
  applied BOOLEAN,
  ledger_id UUID,
  spent_amount NUMERIC,
  remaining_authority NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet intent_wallets%ROWTYPE;
  v_ledger wallet_spend_ledger%ROWTYPE;
BEGIN
  SELECT *
  INTO v_ledger
  FROM wallet_spend_ledger
  WHERE session_id = p_session_id;

  IF FOUND THEN
    SELECT *
    INTO v_wallet
    FROM intent_wallets
    WHERE wallet_id = p_wallet_id;

    RETURN QUERY
    SELECT
      FALSE,
      v_ledger.ledger_id,
      v_wallet.spent_amount,
      v_wallet.total_authority - v_wallet.spent_amount;
    RETURN;
  END IF;

  SELECT *
  INTO v_wallet
  FROM intent_wallets
  WHERE wallet_id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  IF v_wallet.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'WALLET_NOT_ACTIVE';
  END IF;

  IF v_wallet.valid_until <= NOW() THEN
    RAISE EXCEPTION 'WALLET_EXPIRED';
  END IF;

  IF v_wallet.currency <> p_currency THEN
    RAISE EXCEPTION 'WALLET_CURRENCY_MISMATCH';
  END IF;

  IF v_wallet.spent_amount + p_amount > v_wallet.total_authority THEN
    RAISE EXCEPTION 'WALLET_TOTAL_AUTHORITY_EXCEEDED';
  END IF;

  INSERT INTO wallet_spend_ledger(
    session_id,
    wallet_id,
    amount,
    currency,
    provider_link_id,
    provider_payment_id
  )
  VALUES(
    p_session_id,
    p_wallet_id,
    p_amount,
    p_currency,
    p_provider_link_id,
    p_provider_payment_id
  )
  RETURNING *
  INTO v_ledger;

  UPDATE intent_wallets
  SET
    spent_amount = spent_amount + p_amount,
    updated_at = NOW()
  WHERE wallet_id = p_wallet_id
  RETURNING *
  INTO v_wallet;

  RETURN QUERY
  SELECT
    TRUE,
    v_ledger.ledger_id,
    v_wallet.spent_amount,
    v_wallet.total_authority - v_wallet.spent_amount;
END;
$$;
