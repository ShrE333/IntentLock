-- Fix ambiguous spent_amount and serialize replay-safe settlement. No data is changed.
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
