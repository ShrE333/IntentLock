CREATE TABLE IF NOT EXISTS wallet_step_up_requests (
  request_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id) ON DELETE CASCADE,

  transaction_payload JSONB NOT NULL,
  quote_hash TEXT NOT NULL,

  requested_amount NUMERIC(14,2) NOT NULL,
  current_auto_buy_limit NUMERIC(14,2) NOT NULL,
  additional_authority_required NUMERIC(14,2) NOT NULL,

  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','APPROVED_ONCE','LIMIT_RAISED','REJECTED','EXPIRED')),

  expires_at TIMESTAMPTZ NOT NULL,

  resolved_at TIMESTAMPTZ,
  resolution_payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_stepup_wallet
ON wallet_step_up_requests(wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_stepup_status
ON wallet_step_up_requests(status, expires_at);

CREATE TABLE IF NOT EXISTS wallet_one_time_authorizations (
  authorization_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE
    REFERENCES wallet_step_up_requests(request_id) ON DELETE CASCADE,
  wallet_id TEXT NOT NULL
    REFERENCES intent_wallets(wallet_id) ON DELETE CASCADE,

  quote_hash TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,

  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_one_time_auth_wallet
ON wallet_one_time_authorizations(wallet_id, created_at DESC);
