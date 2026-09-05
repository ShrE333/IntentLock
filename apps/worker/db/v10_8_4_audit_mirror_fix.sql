-- IntentLock V10.8.4
-- One audit snapshot can legitimately represent many PurchaseSession events.
-- Therefore audit_event_id must NOT be UNIQUE in session_audit_mirrors.

ALTER TABLE session_audit_mirrors
  DROP CONSTRAINT IF EXISTS session_audit_mirrors_audit_event_id_key;

CREATE INDEX IF NOT EXISTS idx_session_audit_mirrors_audit_event
ON session_audit_mirrors(audit_event_id);

-- Optional sanity check:
-- SELECT audit_event_id, COUNT(*)
-- FROM session_audit_mirrors
-- GROUP BY audit_event_id
-- ORDER BY COUNT(*) DESC;
