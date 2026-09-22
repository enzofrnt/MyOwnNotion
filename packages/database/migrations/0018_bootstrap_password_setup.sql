-- Bootstrap password setup (feature 002 clarifications 2026-09-22).
-- Happy path: started → credential-verified → password-set → confirmed.
-- Recovery-kit download is no longer required to confirm ownership.

ALTER TABLE bootstrap_attempts
  DROP CONSTRAINT IF EXISTS bootstrap_attempts_state_check;

ALTER TABLE bootstrap_attempts
  ADD CONSTRAINT bootstrap_attempts_state_check CHECK (
    bootstrap_state IN (
      'started',
      'credential-verified',
      'password-set',
      'recovery-prepared',
      'download-consumed',
      'confirmed',
      'abandoned',
      'rejected'
    )
  );

ALTER TABLE bootstrap_attempts
  DROP CONSTRAINT IF EXISTS bootstrap_attempts_confirmation_check;

ALTER TABLE bootstrap_attempts
  ADD CONSTRAINT bootstrap_attempts_confirmation_check CHECK (
    (bootstrap_state <> 'confirmed') OR (challenge_hash IS NOT NULL)
  );

DROP INDEX IF EXISTS bootstrap_attempts_open_unique;

CREATE UNIQUE INDEX bootstrap_attempts_open_unique
  ON bootstrap_attempts (installation_id)
  WHERE bootstrap_state IN (
    'started',
    'credential-verified',
    'password-set',
    'recovery-prepared',
    'download-consumed'
  );

DROP INDEX IF EXISTS pending_bootstrap_credentials_attempt_unique;

CREATE UNIQUE INDEX pending_bootstrap_credentials_attempt_kind_unique
  ON pending_bootstrap_credentials (attempt_id, credential_kind);

INSERT INTO schema_migrations (version) VALUES ('0018_bootstrap_password_setup');
