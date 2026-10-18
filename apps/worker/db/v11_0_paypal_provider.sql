-- IntentLock V11.0
-- Provider-neutral PurchaseSession payments + PayPal AUTHORIZE -> CAPTURE.
-- Existing Razorpay data is preserved and backfilled into generic columns.

ALTER TABLE purchase_sessions
  DROP CONSTRAINT IF EXISTS purchase_sessions_status_check;

ALTER TABLE purchase_sessions
  ADD CONSTRAINT purchase_sessions_status_check CHECK(status IN (
    'CREATED','SEARCHING','READY_TO_PAY','AWAITING_STEP_UP',
    'BLOCKED','REJECTED','PAYMENT_PENDING','PAYPAL_APPROVAL_PENDING',
    'AUTHORIZED','CAPTURE_PENDING','CAPTURED','FAILED','CANCELLED'
  ));

ALTER TABLE purchase_sessions
  ADD COLUMN IF NOT EXISTS payment_provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_authorization_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_capture_id TEXT;

UPDATE purchase_sessions
SET
  payment_provider=COALESCE(payment_provider,'razorpay'),
  provider_order_id=COALESCE(provider_order_id,razorpay_payment_link_id),
  provider_capture_id=COALESCE(provider_capture_id,razorpay_payment_id)
WHERE razorpay_payment_link_id IS NOT NULL
   OR razorpay_payment_id IS NOT NULL;

ALTER TABLE session_payment_links
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_authorization_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_capture_id TEXT,
  ADD COLUMN IF NOT EXISTS checkout_url TEXT;

UPDATE session_payment_links
SET
  provider=COALESCE(provider,'razorpay'),
  provider_order_id=COALESCE(provider_order_id,provider_link_id),
  provider_capture_id=COALESCE(provider_capture_id,provider_payment_id),
  checkout_url=COALESCE(checkout_url,short_url);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_payment_provider_order
ON session_payment_links(provider,provider_order_id)
WHERE provider_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_payment_provider_capture
ON session_payment_links(provider,provider_capture_id)
WHERE provider_capture_id IS NOT NULL;

ALTER TABLE session_payment_links
  DROP CONSTRAINT IF EXISTS session_payment_links_currency_check;

ALTER TABLE session_payment_links
  ADD CONSTRAINT session_payment_links_currency_check
  CHECK(currency ~ '^[A-Z]{3}$');

ALTER TABLE wallet_spend_ledger
  DROP CONSTRAINT IF EXISTS wallet_spend_ledger_currency_check;

ALTER TABLE wallet_spend_ledger
  ADD CONSTRAINT wallet_spend_ledger_currency_check
  CHECK(currency ~ '^[A-Z]{3}$');

ALTER TABLE session_payment_webhook_events
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'razorpay';

-- Replay-safe wallet debit with provider identity included in evidence.
CREATE OR REPLACE FUNCTION apply_intent_wallet_spend_once_v11(
  p_session_id TEXT,
  p_wallet_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_provider TEXT,
  p_provider_order_id TEXT,
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
  -- Lock before the ledger check so concurrent deliveries observe the first debit.
  SELECT * INTO v_wallet FROM intent_wallets w
  WHERE w.wallet_id=p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;

  SELECT * INTO v_ledger
  FROM wallet_spend_ledger
  WHERE session_id=p_session_id;

  IF FOUND THEN
    IF v_ledger.wallet_id<>p_wallet_id
       OR v_ledger.amount<>p_amount
       OR UPPER(v_ledger.currency)<>UPPER(p_currency)
       OR v_ledger.provider<>p_provider
       OR v_ledger.provider_link_id IS DISTINCT FROM p_provider_order_id
       OR v_ledger.provider_payment_id IS DISTINCT FROM p_provider_payment_id THEN
      RAISE EXCEPTION 'WALLET_LEDGER_PAYMENT_MISMATCH';
    END IF;

    RETURN QUERY SELECT
      FALSE,
      v_ledger.ledger_id,
      v_wallet.spent_amount,
      v_wallet.total_authority-v_wallet.spent_amount;
    RETURN;
  END IF;

  IF v_wallet.status<>'ACTIVE' THEN RAISE EXCEPTION 'WALLET_NOT_ACTIVE'; END IF;
  IF v_wallet.valid_until<=NOW() THEN RAISE EXCEPTION 'WALLET_EXPIRED'; END IF;
  IF UPPER(v_wallet.currency)<>UPPER(p_currency) THEN RAISE EXCEPTION 'WALLET_CURRENCY_MISMATCH'; END IF;
  IF v_wallet.spent_amount+p_amount>v_wallet.total_authority THEN
    RAISE EXCEPTION 'WALLET_TOTAL_AUTHORITY_EXCEEDED';
  END IF;

  INSERT INTO wallet_spend_ledger(
    session_id,wallet_id,amount,currency,provider,provider_link_id,provider_payment_id
  ) VALUES(
    p_session_id,p_wallet_id,p_amount,UPPER(p_currency),p_provider,
    p_provider_order_id,p_provider_payment_id
  )
  RETURNING * INTO v_ledger;

  UPDATE intent_wallets AS w
  SET spent_amount=w.spent_amount+p_amount,updated_at=NOW()
  WHERE w.wallet_id=p_wallet_id
  RETURNING w.* INTO v_wallet;

  RETURN QUERY SELECT
    TRUE,
    v_ledger.ledger_id,
    v_wallet.spent_amount,
    v_wallet.total_authority-v_wallet.spent_amount;
END;
$$;
