BEGIN;
CREATE TABLE mcp_connections (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  owner_id uuid NOT NULL REFERENCES owners(id),
  authorized_by_device_id uuid NOT NULL REFERENCES authorized_devices(id),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  access_hash text UNIQUE CHECK (access_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE TABLE mcp_exchange_tokens (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES mcp_connections(id) ON DELETE CASCADE,
  secret_hash text NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE mcp_mutations (
  mutation_id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES mcp_connections(id),
  action text NOT NULL,
  target_id uuid NOT NULL
);
ALTER TABLE security_audit_events DROP CONSTRAINT security_audit_events_actor_check;
ALTER TABLE security_audit_events ADD CONSTRAINT security_audit_events_actor_check
 CHECK (actor_class IN ('owner','hosting-admin','system','mcp'));
INSERT INTO schema_migrations(version) VALUES ('0017_mcp_access');
COMMIT;
