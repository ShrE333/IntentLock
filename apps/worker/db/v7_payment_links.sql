CREATE TABLE IF NOT EXISTS payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id TEXT NOT NULL REFERENCES intents(id) ON DELETE RESTRICT,
  approval_id UUID NOT NULL REFERENCES approvals(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_link_id TEXT NOT NULL UNIQUE,
  reference_id TEXT NOT NULL UNIQUE,
  short_url TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency = 'INR'),
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  event_type TEXT NOT NULL,
  provider_entity_id TEXT,
  signature_valid BOOLEAN NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider, payload_hash)
);
