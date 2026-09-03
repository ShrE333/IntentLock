CREATE TABLE IF NOT EXISTS intent_wallets (
  wallet_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  total_authority NUMERIC(14,2) NOT NULL CHECK(total_authority > 0),
  spent_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(spent_amount >= 0),
  auto_buy_limit NUMERIC(14,2) NOT NULL CHECK(auto_buy_limit >= 0),
  max_single_transaction NUMERIC(14,2) NOT NULL CHECK(max_single_transaction > 0),
  allowed_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_brands JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocked_brands JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  valid_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(auto_buy_limit <= max_single_transaction),
  CHECK(max_single_transaction <= total_authority),
  CHECK(spent_amount <= total_authority)
);

CREATE TABLE IF NOT EXISTS wallet_decisions (
  decision_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id) ON DELETE CASCADE,
  transaction_payload JSONB NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('ALLOW','STEP_UP','BLOCK')),
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  remaining_authority NUMERIC(14,2) NOT NULL,
  additional_authority_required NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_decisions_wallet
ON wallet_decisions(wallet_id, created_at DESC);
