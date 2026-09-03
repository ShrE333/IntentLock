CREATE TABLE IF NOT EXISTS purchase_sessions (
  session_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id) ON DELETE RESTRICT,
  channel TEXT NOT NULL DEFAULT 'WEB' CHECK(channel IN ('WEB','WHATSAPP','API')),
  connector_id TEXT NOT NULL DEFAULT 'demo-marketplace',
  user_prompt TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'CREATED' CHECK(status IN (
    'CREATED','SEARCHING','READY_TO_PAY','AWAITING_STEP_UP',
    'BLOCKED','REJECTED','PAYMENT_PENDING','CAPTURED','FAILED','CANCELLED'
  )),

  selected_product JSONB,
  selected_decision TEXT CHECK(
    selected_decision IS NULL OR selected_decision IN ('ALLOW','STEP_UP','BLOCK')
  ),

  step_up_request_id TEXT,
  authorization_id TEXT,

  razorpay_payment_link_id TEXT,
  razorpay_payment_id TEXT,
  proof_receipt_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_purchase_sessions_wallet
ON purchase_sessions(wallet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_session_events (
  event_seq BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES purchase_sessions(session_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_session_events_session
ON purchase_session_events(session_id, event_seq ASC);
