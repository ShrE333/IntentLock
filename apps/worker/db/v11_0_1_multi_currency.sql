-- IntentLock V11.0.1 — Multi-currency / multi-country authority context
-- Additive and backward-compatible with V11.0.

ALTER TABLE intent_wallets
  ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'IN';

ALTER TABLE intent_wallets
  DROP CONSTRAINT IF EXISTS intent_wallets_country_code_check;

ALTER TABLE intent_wallets
  ADD CONSTRAINT intent_wallets_country_code_check
  CHECK (country_code ~ '^[A-Z]{2}$');

COMMENT ON COLUMN intent_wallets.country_code IS
  'ISO-3166 alpha-2 country for the wallet owner/buyer authorization context.';
