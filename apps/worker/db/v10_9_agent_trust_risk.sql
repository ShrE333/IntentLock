-- IntentLock V10.9
-- Adaptive Agent Trust & Risk Engine
--
-- Hard policy remains the authorization authority.
-- Risk may only preserve or RESTRICT an existing policy decision.

CREATE TABLE IF NOT EXISTS agent_risk_assessments (
  assessment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  wallet_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  merchant TEXT,
  amount NUMERIC(18,2) NOT NULL,
  currency TEXT NOT NULL,
  policy_decision TEXT NOT NULL
    CHECK (policy_decision IN ('ALLOW','STEP_UP','BLOCK')),
  trust_score INTEGER NOT NULL
    CHECK (trust_score >= 0 AND trust_score <= 100),
  risk_level TEXT NOT NULL
    CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
  risk_action TEXT NOT NULL
    CHECK (risk_action IN ('OBSERVE','STEP_UP','BLOCK')),
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  engine_version TEXT NOT NULL DEFAULT 'v10.9',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_risk_wallet_created
  ON agent_risk_assessments(wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_risk_agent_created
  ON agent_risk_assessments(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_risk_level_created
  ON agent_risk_assessments(risk_level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_risk_merchant_created
  ON agent_risk_assessments(LOWER(merchant), created_at DESC)
  WHERE merchant IS NOT NULL;
