-- V11.4.4 additive access-control schema. Apply separately after review.
-- No ownership inference, historical financial updates, or automatic grants.
CREATE TABLE financial_resource_owners (
  resource_type TEXT NOT NULL CHECK(resource_type IN ('wallet','intent')),
  resource_id TEXT NOT NULL,
  principal_id TEXT NOT NULL CHECK(principal_id ~ '^(demo|api|wa):'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(resource_type,resource_id)
);
CREATE INDEX financial_owners_principal ON financial_resource_owners(principal_id,resource_type);
CREATE TABLE financial_wallet_grants (
  wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id) ON DELETE RESTRICT,
  principal_id TEXT NOT NULL CHECK(principal_id ~ '^(api|wa):'),
  permissions TEXT[] NOT NULL CHECK(permissions <@ ARRAY['read','authorize','execute','approve']::text[]),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  granted_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(wallet_id,principal_id)
);
CREATE TABLE financial_demo_capabilities (
  token_hash TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL CHECK(principal_id LIKE 'demo:%'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE financial_access_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK(attempts>0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE financial_access_nonces (
  principal_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(principal_id,request_id)
);
CREATE TABLE financial_execution_jobs (
  job_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES purchase_sessions(session_id) ON DELETE RESTRICT,
  principal_id TEXT NOT NULL CHECK(principal_id LIKE 'wa:%'),
  kind TEXT NOT NULL CHECK(kind IN ('RUN_PURCHASE','CREATE_PAYMENT')),
  chat_id TEXT NOT NULL,
  waha_session TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DONE')),
  lease_until TIMESTAMPTZ,
  UNIQUE(session_id,kind)
);
CREATE TABLE financial_access_admin_events (
 event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 action TEXT NOT NULL CHECK(action IN ('GRANT','REVOKE')),
 actor TEXT NOT NULL,
 wallet_id TEXT NOT NULL,
 principal_id TEXT NOT NULL,
 permissions TEXT[],
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
