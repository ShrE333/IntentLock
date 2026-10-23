BEGIN;
ALTER TABLE intent_wallets ADD COLUMN excluded_conditions JSONB NOT NULL DEFAULT '[]'::jsonb
 CHECK (jsonb_typeof(excluded_conditions)='array' AND excluded_conditions <@ '["NEW","USED","REFURBISHED"]'::jsonb);
CREATE TABLE wallet_authority_drafts(
 draft_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL,
 canonical_policy TEXT NOT NULL, policy_digest TEXT NOT NULL CHECK(policy_digest ~ '^[a-f0-9]{64}$'),
 provenance JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 confirmed_at TIMESTAMPTZ, wallet_id TEXT REFERENCES intent_wallets(wallet_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK (encode(digest(canonical_policy,'sha256'),'hex')=policy_digest),
 CHECK ((confirmed_at IS NULL)=(wallet_id IS NULL))
);
CREATE INDEX wallet_authority_drafts_owner ON wallet_authority_drafts(principal_id,created_at DESC);
CREATE TABLE wallet_policy_versions(
 wallet_id TEXT NOT NULL REFERENCES intent_wallets(wallet_id),
 version INTEGER NOT NULL, canonical_policy TEXT NOT NULL,
 policy_digest TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(wallet_id,version),
 CHECK(encode(digest(canonical_policy,'sha256'),'hex')=policy_digest)
);
CREATE FUNCTION wallet_policy_snapshot_v11_5(w intent_wallets) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
 SELECT jsonb_build_object('name',w.name,'currency',w.currency,'countryCode',w.country_code,
 'totalAuthority',w.total_authority,'autoBuyLimit',w.auto_buy_limit,'maxSingleTransaction',w.max_single_transaction,
 'allowedCategories',w.allowed_categories,'allowedBrands',w.allowed_brands,'blockedBrands',w.blocked_brands,
 'requiredFeatures',w.required_features,'excludedConditions',w.excluded_conditions,'validUntil',w.valid_until,'status',w.status)
$$;
CREATE FUNCTION wallet_policy_history_v11_5() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE canonical TEXT; next_version INTEGER;
BEGIN
 IF TG_OP='UPDATE' AND wallet_policy_snapshot_v11_5(OLD)=wallet_policy_snapshot_v11_5(NEW) THEN RETURN NEW; END IF;
 canonical:=wallet_policy_snapshot_v11_5(NEW)::text;
 SELECT COALESCE(MAX(version),0)+1 INTO next_version FROM wallet_policy_versions WHERE wallet_id=NEW.wallet_id;
 INSERT INTO wallet_policy_versions(wallet_id,version,canonical_policy,policy_digest)
 VALUES(NEW.wallet_id,next_version,canonical,encode(digest(canonical,'sha256'),'hex'));
 RETURN NEW;
END $$;
-- Historical baseline snapshots are additive; transaction/receipt evidence is untouched.
INSERT INTO wallet_policy_versions(wallet_id,version,canonical_policy,policy_digest)
 SELECT wallet_id,1,wallet_policy_snapshot_v11_5(w)::text,encode(digest(wallet_policy_snapshot_v11_5(w)::text,'sha256'),'hex')
 FROM intent_wallets w;
CREATE TRIGGER wallet_policy_history AFTER INSERT OR UPDATE ON intent_wallets
 FOR EACH ROW EXECUTE FUNCTION wallet_policy_history_v11_5();
CREATE FUNCTION immutable_wallet_policy_history_v11_5() RETURNS TRIGGER LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'IMMUTABLE_WALLET_POLICY_HISTORY'; END $$;
CREATE TRIGGER immutable_wallet_policy_history BEFORE UPDATE OR DELETE ON wallet_policy_versions
 FOR EACH ROW EXECUTE FUNCTION immutable_wallet_policy_history_v11_5();
COMMIT;
