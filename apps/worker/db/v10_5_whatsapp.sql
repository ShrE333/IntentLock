CREATE TABLE IF NOT EXISTS whatsapp_chat_state (
  chat_id TEXT PRIMARY KEY,
  active_wallet_id TEXT REFERENCES intent_wallets(wallet_id) ON DELETE SET NULL,
  active_session_id TEXT REFERENCES purchase_sessions(session_id) ON DELETE SET NULL,
  waha_session TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  event_id TEXT PRIMARY KEY,
  message_id TEXT UNIQUE,
  chat_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_chat
ON whatsapp_webhook_events(chat_id, created_at DESC);
