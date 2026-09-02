CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  max_amount NUMERIC(14,2) NOT NULL CHECK (max_amount > 0),
  currency TEXT NOT NULL CHECK (currency = 'INR'),
  max_quantity INTEGER NOT NULL CHECK (max_quantity > 0),
  blocked_brands JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  quote_hash CHAR(64) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  product_id TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  currency TEXT NOT NULL CHECK (currency = 'INR'),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  nonce UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id TEXT NOT NULL REFERENCES intents(id) ON DELETE RESTRICT,
  approval_id UUID REFERENCES approvals(id) ON DELETE RESTRICT,
  provider TEXT,
  provider_payment_id TEXT,
  idempotency_key TEXT UNIQUE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL CHECK (currency = 'INR'),
  state TEXT NOT NULL CHECK (
    state IN (
      'CREATED',
      'AUTHORIZED',
      'CAPTURED',
      'FAILED',
      'REFUNDED',
      'BLOCKED'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  sequence BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  stream_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_canonical TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  occurred_at_text TEXT NOT NULL,
  previous_hash CHAR(64),
  event_hash CHAR(64) NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_audit_events_stream_sequence
  ON audit_events(stream_id, sequence);

CREATE INDEX IF NOT EXISTS idx_audit_events_event_type
  ON audit_events(event_type);

-- Atomic append for one audit stream.
-- pg_advisory_xact_lock prevents two concurrent writers from reading the
-- same previous hash and creating a fork in the chain.
CREATE OR REPLACE FUNCTION append_audit_event(
  p_event_id UUID,
  p_stream_id TEXT,
  p_event_type TEXT,
  p_payload JSONB,
  p_payload_canonical TEXT,
  p_occurred_at_text TEXT
)
RETURNS TABLE (
  sequence BIGINT,
  event_id UUID,
  previous_hash TEXT,
  event_hash TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous_hash TEXT;
  v_event_hash TEXT;
  v_sequence BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_stream_id));

  SELECT ae.event_hash
  INTO v_previous_hash
  FROM audit_events ae
  WHERE ae.stream_id = p_stream_id
  ORDER BY ae.sequence DESC
  LIMIT 1;

  v_event_hash := encode(
    digest(
      COALESCE(v_previous_hash, 'GENESIS') || '|' ||
      p_event_id::text || '|' ||
      p_stream_id || '|' ||
      p_event_type || '|' ||
      p_payload_canonical || '|' ||
      p_occurred_at_text,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO audit_events (
    event_id,
    stream_id,
    event_type,
    payload,
    payload_canonical,
    occurred_at,
    occurred_at_text,
    previous_hash,
    event_hash
  )
  VALUES (
    p_event_id,
    p_stream_id,
    p_event_type,
    p_payload,
    p_payload_canonical,
    p_occurred_at_text::timestamptz,
    p_occurred_at_text,
    v_previous_hash,
    v_event_hash
  )
  RETURNING audit_events.sequence INTO v_sequence;

  RETURN QUERY
  SELECT
    v_sequence,
    p_event_id,
    v_previous_hash,
    v_event_hash;
END;
$$;
