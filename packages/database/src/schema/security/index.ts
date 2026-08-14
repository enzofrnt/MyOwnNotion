/**
 * Owner security foundation schema (T019, feature 002).
 *
 * Kept in its own module so the canonical content schema stays readable and
 * untouched. Feature-001 tables are referenced, never modified: `workspace_id`
 * columns hold the exact canonical workspace ID and `entity_id` columns hold
 * exact canonical content IDs.
 *
 * Three invariants are enforced by the database rather than by application
 * code, because application code can be bypassed by a concurrent request:
 *
 *   1. **Singletons.** `installations`, `owners`, `rotation_policies` (per
 *      kind), and `encryption_migrations` use unique indexes — several on a
 *      constant expression — so a second row fails loudly instead of creating
 *      a second owner.
 *   2. **The seven recovery state pairs.** A check constraint enumerates them.
 *      No combination outside the list can be persisted, so a service bug
 *      cannot produce a `provisional/confirmed` kit that would skip offline
 *      confirmation.
 *   3. **At most one open bootstrap attempt.** A partial unique index over the
 *      non-terminal states serializes concurrent claims.
 *
 * Bootstrap material is deliberately *not* owner-scoped: `bootstrap_attempts`
 * and `pending_bootstrap_credentials` reference the installation only. That is
 * what allows the installation to report `ownerCount=0` / `workspaceCount=0`
 * for the entire pre-confirmation workflow.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** A single-row table: a unique index on a constant admits at most one row. */
const singleton = (name: string) => uniqueIndex(name).on(sql`(true)`);

const utc = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

export const installations = pgTable(
  "installations",
  {
    id: uuid("id").primaryKey(),
    /** Stable lineage, adopted verbatim during compatible recovery. */
    sourceLineageId: uuid("source_lineage_id").notNull(),
    state: text("state").notNull().default("uninitialized"),
    /** Null until the atomic promotion; unique once set. */
    ownerId: uuid("owner_id"),
    /** The exact feature-001 workspace ID. Security never regenerates it. */
    workspaceId: uuid("workspace_id"),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    singleton("installations_singleton_idx"),
    check(
      "installations_state_check",
      sql`${table.state} IN ('uninitialized', 'bootstrap-in-progress', 'recovery-required', 'ready', 'migration-in-progress', 'degraded')`,
    ),
    // The count rule, enforced structurally: an uninitialized installation has
    // neither an owner nor a workspace, and an initialized one has both. A
    // half-committed promotion cannot be persisted.
    check(
      "installations_counts_check",
      sql`(
        (${table.state} IN ('uninitialized', 'bootstrap-in-progress')
          AND ${table.ownerId} IS NULL AND ${table.workspaceId} IS NULL)
        OR
        (${table.state} IN ('recovery-required', 'ready', 'migration-in-progress', 'degraded')
          AND ${table.ownerId} IS NOT NULL AND ${table.workspaceId} IS NOT NULL)
      )`,
    ),
    check("installations_schema_version_check", sql`${table.schemaVersion} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// Owner identity and credentials
// ---------------------------------------------------------------------------

export const owners = pgTable(
  "owners",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    state: text("state").notNull().default("active"),
    lastAuthenticatedAt: utc("last_authenticated_at"),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    // One owner per installation, and one installation overall.
    uniqueIndex("owners_installation_unique").on(table.installationId),
    check("owners_state_check", sql`${table.state} IN ('active', 'recovery-required')`),
  ],
);

export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id),
    /** WebAuthn credential ID, base64url. Not a secret, but an identifier. */
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    /** Monotonic; a lower value on assertion indicates a cloned authenticator. */
    signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
    label: text("label"),
    state: text("state").notNull().default("pending"),
    createdAt: utc("created_at").notNull().defaultNow(),
    lastUsedAt: utc("last_used_at"),
    revokedAt: utc("revoked_at"),
  },
  (table) => [
    uniqueIndex("passkey_credentials_credential_id_unique").on(table.credentialId),
    index("passkey_credentials_owner_idx").on(table.ownerId, table.state),
    check(
      "passkey_credentials_state_check",
      sql`${table.state} IN ('pending', 'active', 'revoked')`,
    ),
    check("passkey_credentials_sign_count_check", sql`${table.signCount} >= 0`),
    check(
      "passkey_credentials_revoked_at_check",
      sql`(${table.state} <> 'revoked') OR (${table.revokedAt} IS NOT NULL)`,
    ),
  ],
);

export const passwordCredentialVersions = pgTable(
  "password_credential_versions",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id),
    /** Versioned hash; the password itself is never persisted or returned. */
    passwordHash: text("password_hash").notNull(),
    hashAlgorithm: text("hash_algorithm").notNull(),
    hashParameters: jsonb("hash_parameters").notNull().default({}),
    state: text("state").notNull().default("active"),
    createdAt: utc("created_at").notNull().defaultNow(),
    supersededAt: utc("superseded_at"),
  },
  (table) => [
    // At most one active password version per owner.
    uniqueIndex("password_credential_versions_active_unique")
      .on(table.ownerId)
      .where(sql`${table.state} = 'active'`),
    check(
      "password_credential_versions_state_check",
      sql`${table.state} IN ('active', 'superseded', 'revoked')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Bootstrap (attempt-scoped: no owner foreign key anywhere here)
// ---------------------------------------------------------------------------

export const bootstrapAttempts = pgTable(
  "bootstrap_attempts",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    bootstrapState: text("bootstrap_state").notNull().default("started"),
    clientNonceHash: text("client_nonce_hash").notNull(),
    challengeHash: text("challenge_hash"),
    /** Hash of the browser-held capability; the capability itself never lands. */
    capabilityHash: text("capability_hash").notNull(),
    downloadTokenHash: text("download_token_hash"),
    downloadExpiresAt: utc("download_expires_at"),
    downloadConsumedAt: utc("download_consumed_at"),
    recoveryKitId: uuid("recovery_kit_id"),
    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // One open attempt at a time: concurrent claims serialize on this index
    // and the losers fail loudly rather than each creating an owner.
    uniqueIndex("bootstrap_attempts_open_unique")
      .on(table.installationId)
      .where(
        sql`${table.bootstrapState} IN ('started', 'credential-verified', 'recovery-prepared', 'download-consumed')`,
      ),
    index("bootstrap_attempts_state_idx").on(table.installationId, table.bootstrapState),
    check(
      "bootstrap_attempts_state_check",
      sql`${table.bootstrapState} IN ('started', 'credential-verified', 'recovery-prepared', 'download-consumed', 'confirmed', 'abandoned', 'rejected')`,
    ),
    // A consumed download must record when, and must have had a window.
    check(
      "bootstrap_attempts_download_check",
      sql`(${table.downloadConsumedAt} IS NULL) OR (${table.downloadExpiresAt} IS NOT NULL AND ${table.downloadTokenHash} IS NOT NULL)`,
    ),
    // Confirmation is reachable only from a consumed download.
    check(
      "bootstrap_attempts_confirmation_check",
      sql`(${table.bootstrapState} <> 'confirmed') OR (${table.downloadConsumedAt} IS NOT NULL AND ${table.recoveryKitId} IS NOT NULL)`,
    ),
  ],
);

export const pendingBootstrapCredentials = pgTable(
  "pending_bootstrap_credentials",
  {
    id: uuid("id").primaryKey(),
    /**
     * Scoped to the attempt, never to an owner: this record exists precisely
     * while `ownerCount` is still 0.
     */
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => bootstrapAttempts.id, { onDelete: "cascade" }),
    credentialKind: text("credential_kind").notNull(),
    /** Blinded handle; never the credential itself. */
    credentialIdDigest: text("credential_id_digest").notNull(),
    publicKey: text("public_key"),
    passwordHash: text("password_hash"),
    hashAlgorithm: text("hash_algorithm"),
    hashParameters: jsonb("hash_parameters").notNull().default({}),
    origin: text("origin").notNull(),
    relyingPartyId: text("relying_party_id"),
    signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
    userVerified: text("user_verified").notNull().default("false"),
    verifiedAt: utc("verified_at").notNull().defaultNow(),
    expiresAt: utc("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("pending_bootstrap_credentials_attempt_unique").on(table.attemptId),
    check(
      "pending_bootstrap_credentials_kind_check",
      sql`${table.credentialKind} IN ('passkey', 'password')`,
    ),
    check(
      "pending_bootstrap_credentials_material_check",
      sql`(
        (${table.credentialKind} = 'passkey' AND ${table.publicKey} IS NOT NULL)
        OR
        (${table.credentialKind} = 'password' AND ${table.passwordHash} IS NOT NULL AND ${table.hashAlgorithm} IS NOT NULL)
      )`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Devices and sessions
// ---------------------------------------------------------------------------

export const authorizedDevices = pgTable(
  "authorized_devices",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id),
    deviceBindingId: text("device_binding_id").notNull(),
    name: text("name").notNull(),
    platform: text("platform"),
    clientType: text("client_type").notNull().default("web"),
    state: text("state").notNull().default("pending"),
    authorizedAt: utc("authorized_at").notNull().defaultNow(),
    /**
     * Null until the *first real* authenticated activity event, and set only
     * by that event. Registration, rename, inventory reads, and revocation
     * must never synthesize it — the API returns this null verbatim.
     */
    lastActivityAt: utc("last_activity_at"),
    /** Same rule: null until the first successful synchronization. */
    lastSyncAt: utc("last_sync_at"),
    localStorageLimitBytes: bigint("local_storage_limit_bytes", { mode: "number" }),
    localStorageUsedBytes: bigint("local_storage_used_bytes", { mode: "number" })
      .notNull()
      .default(0),
    keyProtectionCapability: text("key_protection_capability"),
    deviceKeyVersion: integer("device_key_version").notNull().default(1),
    revokedAt: utc("revoked_at"),
  },
  (table) => [
    uniqueIndex("authorized_devices_binding_unique").on(table.ownerId, table.deviceBindingId),
    index("authorized_devices_owner_state_idx").on(table.ownerId, table.state),
    check(
      "authorized_devices_state_check",
      sql`${table.state} IN ('pending', 'active', 'revoked', 'reauthorization-required')`,
    ),
    check("authorized_devices_client_type_check", sql`${table.clientType} = 'web'`),
    check(
      "authorized_devices_revoked_at_check",
      sql`(${table.state} <> 'revoked') OR (${table.revokedAt} IS NOT NULL)`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => authorizedDevices.id),
    /** Hash of the opaque session secret. The secret lives only in the cookie. */
    sessionSecretHash: text("session_secret_hash").notNull(),
    /**
     * `passkey` or `password` only. The local CLI never creates a session and
     * is therefore never an auth method.
     */
    authMethod: text("auth_method").notNull(),
    issuedAt: utc("issued_at").notNull().defaultNow(),
    lastSeenAt: utc("last_seen_at").notNull().defaultNow(),
    expiresAt: utc("expires_at").notNull(),
    recentAuthAt: utc("recent_auth_at").notNull(),
    state: text("state").notNull().default("active"),
    revokedAt: utc("revoked_at"),
  },
  (table) => [
    uniqueIndex("sessions_secret_hash_unique").on(table.sessionSecretHash),
    index("sessions_owner_state_idx").on(table.ownerId, table.state),
    index("sessions_device_idx").on(table.deviceId),
    check("sessions_auth_method_check", sql`${table.authMethod} IN ('passkey', 'password')`),
    check("sessions_state_check", sql`${table.state} IN ('active', 'revoked', 'expired')`),
    check(
      "sessions_revoked_at_check",
      sql`(${table.state} <> 'revoked') OR (${table.revokedAt} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export const recoveryEpochs = pgTable(
  "recovery_epochs",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    epoch: integer("epoch").notNull(),
    state: text("state").notNull().default("active"),
    /** Safe, non-identifying code shown to the owner after a revocation. */
    revocationCode: text("revocation_code"),
    createdAt: utc("created_at").notNull().defaultNow(),
    revokedAt: utc("revoked_at"),
  },
  (table) => [
    uniqueIndex("recovery_epochs_epoch_unique").on(table.installationId, table.epoch),
    // Exactly one active epoch at a time.
    uniqueIndex("recovery_epochs_active_unique")
      .on(table.installationId)
      .where(sql`${table.state} = 'active'`),
    check("recovery_epochs_state_check", sql`${table.state} IN ('active', 'revoked')`),
    check("recovery_epochs_epoch_check", sql`${table.epoch} >= 1`),
  ],
);

export const recoveryKits = pgTable(
  "recovery_kits",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    sourceLineageId: uuid("source_lineage_id").notNull(),
    recoveryEpoch: integer("recovery_epoch").notNull(),
    authorizationState: text("authorization_state").notNull(),
    deliveryState: text("delivery_state").notNull(),
    format: text("format").notNull().default("myownnotion.recovery+json"),
    formatVersion: integer("format_version").notNull().default(1),
    supportedKeyGenerations: integer("supported_key_generations").array().notNull(),
    /** Digest only. The artifact is streamed, never colocated with the data. */
    artifactDigest: text("artifact_digest").notNull(),
    downloadTokenHash: text("download_token_hash"),
    downloadExpiresAt: utc("download_expires_at"),
    downloadConsumedAt: utc("download_consumed_at"),
    createdAt: utc("created_at").notNull().defaultNow(),
    confirmedAt: utc("confirmed_at"),
    supersededAt: utc("superseded_at"),
    revokedAt: utc("revoked_at"),
  },
  (table) => [
    index("recovery_kits_installation_idx").on(table.installationId, table.authorizationState),
    // Exactly one usable kit at a time.
    uniqueIndex("recovery_kits_active_unique")
      .on(table.installationId)
      .where(sql`${table.authorizationState} = 'active'`),
    // The seven legal pairs, exhaustively. Every other combination — including
    // `provisional/expired` and a `provisional/confirmed` shortcut that would
    // bypass offline confirmation — is rejected by the database.
    check(
      "recovery_kits_state_pair_check",
      sql`(${table.authorizationState}, ${table.deliveryState}) IN (
        ('provisional', 'prepared'),
        ('provisional', 'downloadable'),
        ('provisional', 'download-consumed'),
        ('active', 'confirmed'),
        ('superseded', 'confirmed'),
        ('revoked', 'confirmed'),
        ('rejected', 'expired')
      )`,
    ),
    check(
      "recovery_kits_confirmed_at_check",
      sql`(${table.deliveryState} <> 'confirmed') OR (${table.confirmedAt} IS NOT NULL)`,
    ),
    check(
      "recovery_kits_consumed_at_check",
      sql`(${table.deliveryState} <> 'download-consumed') OR (${table.downloadConsumedAt} IS NOT NULL)`,
    ),
    check(
      "recovery_kits_generations_check",
      sql`cardinality(${table.supportedKeyGenerations}) >= 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Key hierarchy
// ---------------------------------------------------------------------------

export const wrappingKeyVersions = pgTable(
  "wrapping_key_versions",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    version: integer("version").notNull(),
    /** A reference to the mounted secret, never the secret bytes. */
    externalSecretReference: text("external_secret_reference").notNull(),
    algorithm: text("algorithm").notNull(),
    state: text("state").notNull().default("current"),
    availabilityCheckedAt: utc("availability_checked_at"),
    availabilityStatus: text("availability_status"),
    createdAt: utc("created_at").notNull().defaultNow(),
    revokedAt: utc("revoked_at"),
  },
  (table) => [
    uniqueIndex("wrapping_key_versions_version_unique").on(table.installationId, table.version),
    uniqueIndex("wrapping_key_versions_current_unique")
      .on(table.installationId)
      .where(sql`${table.state} = 'current'`),
    check(
      "wrapping_key_versions_state_check",
      // `pending` is a version a rotation is rewrapping *towards*: it exists so
      // the rewrapped rows have something to reference, and it becomes
      // `current` only once every workspace root key opens under it.
      sql`${table.state} IN ('current', 'pending', 'previous', 'revoked')`,
    ),
    check("wrapping_key_versions_version_check", sql`${table.version} >= 1`),
  ],
);

export const workspaceRootKeys = pgTable(
  "workspace_root_keys",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    /** Feature-001 workspace ID, verbatim. */
    workspaceId: uuid("workspace_id").notNull(),
    wrappingKeyVersionId: uuid("wrapping_key_version_id")
      .notNull()
      .references(() => wrappingKeyVersions.id),
    /** Ciphertext only. Root key bytes are never logged or returned. */
    wrappedRootKey: text("wrapped_root_key").notNull(),
    rootKeyVersion: integer("root_key_version").notNull(),
    state: text("state").notNull().default("active"),
    rewrapOperationId: uuid("rewrap_operation_id"),
    createdAt: utc("created_at").notNull().defaultNow(),
    revokedAt: utc("revoked_at"),
  },
  (table) => [
    uniqueIndex("workspace_root_keys_version_unique").on(table.workspaceId, table.rootKeyVersion),
    uniqueIndex("workspace_root_keys_active_unique")
      .on(table.workspaceId)
      .where(sql`${table.state} = 'active'`),
    check(
      "workspace_root_keys_state_check",
      sql`${table.state} IN ('active', 'previous', 'revoked')`,
    ),
  ],
);

export const dataKeyGenerations = pgTable(
  "data_key_generations",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    workspaceId: uuid("workspace_id").notNull(),
    generation: integer("generation").notNull(),
    wrappedKeyMaterial: text("wrapped_key_material").notNull(),
    /** `decrypt-only` keeps old records readable after a rotation. */
    state: text("state").notNull().default("current"),
    recordCount: bigint("record_count", { mode: "number" }).notNull().default(0),
    chunkCount: bigint("chunk_count", { mode: "number" }).notNull().default(0),
    createdAt: utc("created_at").notNull().defaultNow(),
    revokedAt: utc("revoked_at"),
  },
  (table) => [
    uniqueIndex("data_key_generations_generation_unique").on(table.workspaceId, table.generation),
    uniqueIndex("data_key_generations_current_unique")
      .on(table.workspaceId)
      .where(sql`${table.state} = 'current'`),
    check(
      "data_key_generations_state_check",
      sql`${table.state} IN ('current', 'decrypt-only', 'revoked')`,
    ),
    check("data_key_generations_generation_check", sql`${table.generation} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

export const rotationPolicies = pgTable(
  "rotation_policies",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    kind: text("kind").notNull(),
    mode: text("mode").notNull().default("scheduled"),
    dueIntervalDays: integer("due_interval_days").notNull(),
    dueAt: utc("due_at").notNull(),
    writeBlockAt: utc("write_block_at").notNull(),
    lastCompletedAt: utc("last_completed_at"),
    currentGeneration: integer("current_generation").notNull().default(1),
    state: text("state").notNull().default("pre-due"),
    lastOperationId: uuid("last_operation_id"),
    nextAction: text("next_action").notNull().default("none"),
    lastFailureAt: utc("last_failure_at"),
    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // Exactly one policy per kind: wrapping-key and data-key are separate
    // namespaces with separate operation streams.
    uniqueIndex("rotation_policies_kind_unique").on(table.installationId, table.kind),
    check("rotation_policies_kind_check", sql`${table.kind} IN ('wrapping-key', 'data-key')`),
    check("rotation_policies_mode_check", sql`${table.mode} IN ('scheduled', 'emergency')`),
    check(
      "rotation_policies_state_check",
      sql`${table.state} IN ('pre-due', 'due', 'overdue-within-grace', 'emergency', 'write-block', 'in-progress', 'complete', 'failed')`,
    ),
    // Emergency has zero grace, so the block lands on the due date itself.
    check("rotation_policies_write_block_check", sql`${table.writeBlockAt} >= ${table.dueAt}`),
    check("rotation_policies_interval_check", sql`${table.dueIntervalDays} >= 1`),
  ],
);

export const rotationOperations = pgTable(
  "rotation_operations",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => rotationPolicies.id),
    kind: text("kind").notNull(),
    mode: text("mode").notNull(),
    fromVersionOrGeneration: integer("from_version_or_generation").notNull(),
    toVersionOrGeneration: integer("to_version_or_generation").notNull(),
    phase: text("phase").notNull().default("planned"),
    auditReason: text("audit_reason"),
    cursor: text("cursor").notNull().default(""),
    processedCount: bigint("processed_count", { mode: "number" }).notNull().default(0),
    totalCount: bigint("total_count", { mode: "number" }).notNull().default(0),
    failureCode: text("failure_code"),
    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // At most one operation in flight per policy.
    uniqueIndex("rotation_operations_active_unique")
      .on(table.policyId)
      .where(
        sql`${table.phase} IN ('planned', 'prepared', 'rewrapping', 'rewriting', 'committing')`,
      ),
    index("rotation_operations_policy_idx").on(table.policyId, table.phase),
    check("rotation_operations_kind_check", sql`${table.kind} IN ('wrapping-key', 'data-key')`),
    check("rotation_operations_mode_check", sql`${table.mode} IN ('scheduled', 'emergency')`),
    check(
      "rotation_operations_phase_check",
      sql`${table.phase} IN ('planned', 'prepared', 'rewrapping', 'rewriting', 'committing', 'complete', 'failed')`,
    ),
    check(
      "rotation_operations_progression_check",
      sql`${table.toVersionOrGeneration} > ${table.fromVersionOrGeneration}`,
    ),
  ],
);

export const rotationCheckpoints = pgTable(
  "rotation_checkpoints",
  {
    id: uuid("id").primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => rotationOperations.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    cursor: text("cursor").notNull(),
    processedCount: bigint("processed_count", { mode: "number" }).notNull().default(0),
    totalCount: bigint("total_count", { mode: "number" }).notNull().default(0),
    checkpointDigest: text("checkpoint_digest").notNull(),
    /** A replay with the same key returns the prior result, never a duplicate. */
    idempotencyKey: text("idempotency_key").notNull(),
    committedAt: utc("committed_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rotation_checkpoints_sequence_unique").on(table.operationId, table.sequence),
    uniqueIndex("rotation_checkpoints_idempotency_unique").on(
      table.operationId,
      table.idempotencyKey,
    ),
    check("rotation_checkpoints_sequence_check", sql`${table.sequence} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Protected records and chunks
// ---------------------------------------------------------------------------

export const protectedEnvelopes = pgTable(
  "protected_envelopes",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    workspaceId: uuid("workspace_id").notNull(),
    entityType: text("entity_type").notNull(),
    /** Feature-001 entity ID, verbatim. Security never rewrites it. */
    entityId: uuid("entity_id").notNull(),
    keyGeneration: integer("key_generation").notNull(),
    recordVersion: integer("record_version").notNull(),
    format: text("format").notNull().default("mn.enc.v1"),
    algorithm: text("algorithm").notNull().default("AES-256-GCM+HKDF-SHA-256"),
    salt: text("salt").notNull(),
    nonce: text("nonce").notNull(),
    ciphertext: text("ciphertext").notNull(),
    tag: text("tag").notNull(),
    aadDigest: text("aad_digest").notNull(),
    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("protected_envelopes_entity_unique").on(
      table.entityType,
      table.entityId,
      table.recordVersion,
    ),
    index("protected_envelopes_generation_idx").on(table.workspaceId, table.keyGeneration),
    check("protected_envelopes_format_check", sql`${table.format} = 'mn.enc.v1'`),
    check(
      "protected_envelopes_algorithm_check",
      sql`${table.algorithm} = 'AES-256-GCM+HKDF-SHA-256'`,
    ),
    check("protected_envelopes_generation_check", sql`${table.keyGeneration} >= 1`),
    check("protected_envelopes_record_version_check", sql`${table.recordVersion} >= 1`),
  ],
);

export const protectedBlobChunks = pgTable(
  "protected_blob_chunks",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    workspaceId: uuid("workspace_id").notNull(),
    /** Feature-001 file-content ID, verbatim. */
    contentId: uuid("content_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    keyGeneration: integer("key_generation").notNull(),
    recordVersion: integer("record_version").notNull().default(1),
    storageKey: text("storage_key").notNull(),
    salt: text("salt").notNull(),
    nonce: text("nonce").notNull(),
    tag: text("tag").notNull(),
    aadDigest: text("aad_digest").notNull(),
    byteLength: bigint("byte_length", { mode: "number" }).notNull(),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("protected_blob_chunks_chunk_unique").on(table.contentId, table.chunkIndex),
    uniqueIndex("protected_blob_chunks_storage_key_unique").on(table.storageKey),
    index("protected_blob_chunks_generation_idx").on(table.workspaceId, table.keyGeneration),
    check("protected_blob_chunks_index_check", sql`${table.chunkIndex} >= 0`),
    check("protected_blob_chunks_length_check", sql`${table.byteLength} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Plaintext migration
// ---------------------------------------------------------------------------

export const encryptionMigrations = pgTable(
  "encryption_migrations",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    workspaceId: uuid("workspace_id").notNull(),
    sourceSchemaVersion: integer("source_schema_version").notNull(),
    destinationSchemaVersion: integer("destination_schema_version").notNull(),
    state: text("state").notNull().default("prepare-destinations"),
    /** Source plaintext is retained until a verified cutover and cleanup. */
    sourceRetained: text("source_retained").notNull().default("true"),
    sourceCount: bigint("source_count", { mode: "number" }).notNull().default(0),
    destinationCount: bigint("destination_count", { mode: "number" }).notNull().default(0),
    sourceDigest: text("source_digest"),
    destinationDigest: text("destination_digest"),
    identityDigest: text("identity_digest"),
    cursor: text("cursor").notNull().default(""),
    lastSafeCheckpointId: uuid("last_safe_checkpoint_id"),
    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // One migration per installation.
    uniqueIndex("encryption_migrations_installation_unique").on(table.installationId),
    check(
      "encryption_migrations_state_check",
      sql`${table.state} IN ('prepare-destinations', 'capture-boundary', 'backfill', 'verify', 'stop-plaintext-writes', 'encrypted-read-cutover', 'scrub-plaintext', 'complete', 'failed')`,
    ),
    // Plaintext may only be released after the read cutover has happened.
    check(
      "encryption_migrations_retention_check",
      sql`(${table.sourceRetained} = 'true') OR (${table.state} IN ('scrub-plaintext', 'complete'))`,
    ),
  ],
);

export const migrationCheckpoints = pgTable(
  "migration_checkpoints",
  {
    id: uuid("id").primaryKey(),
    migrationId: uuid("migration_id")
      .notNull()
      .references(() => encryptionMigrations.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    state: text("state").notNull(),
    sourceCursor: text("source_cursor").notNull(),
    destinationCursor: text("destination_cursor").notNull(),
    batchCount: bigint("batch_count", { mode: "number" }).notNull().default(0),
    recordCount: bigint("record_count", { mode: "number" }).notNull().default(0),
    blobCount: bigint("blob_count", { mode: "number" }).notNull().default(0),
    identityDigest: text("identity_digest").notNull(),
    checkpointDigest: text("checkpoint_digest").notNull(),
    /** Set when a fault interrupted this checkpoint, for resume diagnostics. */
    faultPoint: text("fault_point"),
    idempotencyKey: text("idempotency_key").notNull(),
    committedAt: utc("committed_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("migration_checkpoints_sequence_unique").on(table.migrationId, table.sequence),
    uniqueIndex("migration_checkpoints_idempotency_unique").on(
      table.migrationId,
      table.idempotencyKey,
    ),
    check("migration_checkpoints_sequence_check", sql`${table.sequence} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Rate limiting and audit
// ---------------------------------------------------------------------------

export const securityRateLimits = pgTable(
  "security_rate_limits",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    /** Opaque bucket key: an operation class plus a hashed subject. */
    bucketKey: text("bucket_key").notNull(),
    windowStartedAt: utc("window_started_at").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    blockedUntil: utc("blocked_until"),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("security_rate_limits_bucket_unique").on(table.installationId, table.bucketKey),
    check("security_rate_limits_count_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const securityAuditEvents = pgTable(
  "security_audit_events",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    workspaceId: uuid("workspace_id"),
    eventType: text("event_type").notNull(),
    outcome: text("outcome").notNull(),
    actorClass: text("actor_class").notNull(),
    correlationId: text("correlation_id").notNull(),
    safeCode: text("safe_code"),
    objectKind: text("object_kind"),
    /** Opaque where safe; never a content identifier that reveals a title. */
    objectId: text("object_id"),
    /**
     * Redacted metadata only. The audit repository passes every payload through
     * `redact()` and refuses a row that still carries a forbidden field, so no
     * content, credential, token, capability, kit, or key material lands here.
     */
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: utc("occurred_at").notNull().defaultNow(),
  },
  (table) => [
    index("security_audit_events_occurred_idx").on(table.installationId, table.occurredAt),
    index("security_audit_events_type_idx").on(table.installationId, table.eventType),
    check(
      "security_audit_events_outcome_check",
      sql`${table.outcome} IN ('success', 'failure', 'refused', 'started')`,
    ),
    check(
      "security_audit_events_actor_check",
      sql`${table.actorClass} IN ('owner', 'hosting-admin', 'system')`,
    ),
  ],
);
