-- IntentLock V10.8
-- External authorization API + hashed API clients + WhatsApp pairing gate.

CREATE TABLE IF NOT EXISTS api_clients (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash CHAR(64) NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '["authorize","verify"]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_clients_status
ON api_clients(status);

CREATE TABLE IF NOT EXISTS api_authorization_requests (
  request_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL
    REFERENCES api_clients(client_id)
    ON DELETE RESTRICT,

  idempotency_key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL
    REFERENCES intent_wallets(wallet_id)
    ON DELETE RESTRICT,

  merchant TEXT NOT NULL,
  transaction_payload JSONB NOT NULL,
  quote_hash CHAR(64) NOT NULL,

  decision TEXT NOT NULL
    CHECK (decision IN ('ALLOW','STEP_UP','BLOCK')),

  violations JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  remaining_authority NUMERIC(14,2) NOT NULL DEFAULT 0,
  additional_authority_required NUMERIC(14,2) NOT NULL DEFAULT 0,

  step_up_request_id TEXT,
  authorization_id TEXT,
  token_hash CHAR(64),
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(client_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_api_auth_wallet
ON api_authorization_requests(wallet_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_auth_agent
ON api_authorization_requests(agent_id,created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_authorized_chats (
  chat_id TEXT PRIMARY KEY,
  label TEXT,
  paired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_authorized_active
ON whatsapp_authorized_chats(chat_id)
WHERE revoked_at IS NULL;
