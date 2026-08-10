/**
 * Versioned security artifact schemas (T014, feature 002).
 *
 * Executable mirror of
 * `specs/002-owner-security-foundation/contracts/security-artifacts.schema.json`.
 * `tests/contract/security-artifacts.schema.spec.ts` keeps the two aligned;
 * this module is what the API, the domain, and the CLI actually validate
 * against at runtime.
 *
 * Two things here are easy to get wrong and are therefore encoded structurally
 * rather than left to convention:
 *
 *   1. **A recovery kit has two independent axes, never one mixed `state`.**
 *      `authorizationState` says what the kit is allowed to do;
 *      `deliveryState` says how far its one-time delivery got. Exactly seven
 *      pairs are legal (`RECOVERY_STATE_PAIRS`), and `RecoveryKitSchema` is a
 *      union over those pairs, so an illegal combination fails validation
 *      rather than being caught by a hand-written guard someone forgets.
 *   2. **Raw key material never appears in an artifact.** Every secret is
 *      inside an `encryption` block; the surrounding metadata is safe to log,
 *      persist, and show to the owner.
 */
import {
  ENVELOPE_ALGORITHM as DOMAIN_ENVELOPE_ALGORITHM,
  ENVELOPE_FORMAT as DOMAIN_ENVELOPE_FORMAT,
  RECOVERY_STATE_PAIRS as DOMAIN_RECOVERY_STATE_PAIRS,
  type EncryptedEnvelope as DomainEncryptedEnvelope,
  MIGRATION_STATES,
  RECOVERY_AUTHORIZATION_STATES,
  RECOVERY_DELIVERY_STATES,
  type RecoveryAuthorizationState,
  type RecoveryDeliveryState,
} from "@myownnotion/domain";
import { type Static, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const ArtifactUuidSchema = Type.String({ format: "uuid" });

/**
 * Unpadded base64url. The schema's fixed lengths encode byte counts:
 * 22 characters = 16 bytes (salt, GCM tag), 16 characters = 12 bytes (nonce),
 * 43 characters = 32 bytes (SHA-256 digest).
 */
export const Base64UrlSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$", minLength: 1 });

const Base64UrlOfBytes = (characters: number) =>
  Type.String({ pattern: "^[A-Za-z0-9_-]+$", minLength: characters, maxLength: characters });

/** base64url character counts for the fixed-width fields. */
export const B64_LENGTHS = {
  /** 16 bytes */
  salt: 22,
  /** 12 bytes */
  nonce: 16,
  /** 16 bytes */
  tag: 22,
  /** 32 bytes */
  digest: 43,
} as const;

export const GenerationSchema = Type.Integer({ minimum: 1 });
export type Generation = Static<typeof GenerationSchema>;

// ---------------------------------------------------------------------------
// mn.enc.v1 authenticated envelope
// ---------------------------------------------------------------------------

export const ENVELOPE_FORMAT = DOMAIN_ENVELOPE_FORMAT;
export const ENVELOPE_ALGORITHM = DOMAIN_ENVELOPE_ALGORITHM;

export const EncryptedEnvelopeSchema = Type.Object(
  {
    format: Type.Literal(ENVELOPE_FORMAT),
    /** Logical record class, e.g. `page.document`, `file.chunk`. */
    entityType: Type.String({ pattern: "^[a-z][a-z0-9._-]{1,63}$" }),
    entityId: ArtifactUuidSchema,
    workspaceId: ArtifactUuidSchema,
    keyGeneration: GenerationSchema,
    recordVersion: Type.Integer({ minimum: 1 }),
    algorithm: Type.Literal(ENVELOPE_ALGORITHM),
    /** Per-record HKDF salt. Public; it is not a secret. */
    salt: Base64UrlOfBytes(B64_LENGTHS.salt),
    nonce: Base64UrlOfBytes(B64_LENGTHS.nonce),
    ciphertext: Base64UrlSchema,
    tag: Base64UrlOfBytes(B64_LENGTHS.tag),
    /**
     * SHA-256 over the canonical additional-authenticated-data string. Stored
     * so a decrypt can prove the AAD it reconstructed matches the one the
     * encrypt used, before it trusts the GCM tag result.
     */
    aadDigest: Base64UrlOfBytes(B64_LENGTHS.digest),
    /** Present only for file chunks. */
    chunkIndex: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type EncryptedEnvelope = Static<typeof EncryptedEnvelopeSchema>;

/**
 * The schema and the domain type must describe the same record. The domain
 * cannot import this module — `@myownnotion/contracts` depends on
 * `@myownnotion/domain`, not the reverse — so assignability in both directions
 * is asserted here instead. A field added to one and not the other stops the
 * build rather than surfacing as a runtime validation gap.
 */
const _envelopeMatchesDomain: DomainEncryptedEnvelope = {} as EncryptedEnvelope;
const _domainMatchesEnvelope: EncryptedEnvelope = {} as DomainEncryptedEnvelope;
void _envelopeMatchesDomain;
void _domainMatchesEnvelope;

// ---------------------------------------------------------------------------
// Recovery kit
// ---------------------------------------------------------------------------

export const RECOVERY_FORMAT = "myownnotion.recovery+json" as const;

export const RecoveryAuthorizationStates = RECOVERY_AUTHORIZATION_STATES;
export type { RecoveryAuthorizationState };

export const RecoveryDeliveryStates = RECOVERY_DELIVERY_STATES;
export type { RecoveryDeliveryState };

/**
 * The only seven legal combinations. Anything else — `active/prepared`,
 * `revoked/downloadable`, a `provisional/confirmed` shortcut that would skip
 * offline confirmation — is not a valid artifact.
 */
export const RECOVERY_STATE_PAIRS = DOMAIN_RECOVERY_STATE_PAIRS;

export type RecoveryStatePair = (typeof RECOVERY_STATE_PAIRS)[number];

export function isLegalRecoveryStatePair(
  authorizationState: string,
  deliveryState: string,
): boolean {
  return RECOVERY_STATE_PAIRS.some(
    (pair) =>
      pair.authorizationState === authorizationState && pair.deliveryState === deliveryState,
  );
}

export const RECOVERY_KDF_ALGORITHM = "scrypt" as const;
/** Permitted scrypt cost parameters; the schema admits no other value. */
export const RECOVERY_KDF_COST_OPTIONS = [8192, 16384, 32768, 65536, 131072] as const;

export const RecoveryKdfSchema = Type.Object(
  {
    algorithm: Type.Literal(RECOVERY_KDF_ALGORITHM),
    N: Type.Union(RECOVERY_KDF_COST_OPTIONS.map((cost) => Type.Literal(cost))),
    r: Type.Literal(8),
    p: Type.Integer({ minimum: 1, maximum: 10 }),
    keyLength: Type.Literal(32),
    salt: Base64UrlOfBytes(B64_LENGTHS.salt),
  },
  { additionalProperties: false },
);
export type RecoveryKdf = Static<typeof RecoveryKdfSchema>;

export const RecoveryEncryptionSchema = Type.Object(
  {
    algorithm: Type.Literal("AES-256-GCM"),
    nonce: Base64UrlOfBytes(B64_LENGTHS.nonce),
    ciphertext: Base64UrlSchema,
    tag: Base64UrlOfBytes(B64_LENGTHS.tag),
  },
  { additionalProperties: false },
);
export type RecoveryEncryption = Static<typeof RecoveryEncryptionSchema>;

const RecoveryKitCommonProperties = {
  format: Type.Literal(RECOVERY_FORMAT),
  formatVersion: Type.Literal(1),
  installationId: ArtifactUuidSchema,
  /**
   * Identity of the lineage this kit recovers. A replacement installation
   * adopts the source lineage; it does not mint a new one.
   */
  sourceLineageId: ArtifactUuidSchema,
  kitId: ArtifactUuidSchema,
  recoveryEpoch: Type.Integer({ minimum: 1 }),
  createdAt: Type.String({ format: "date-time" }),
  supportedKeyGenerations: Type.Array(GenerationSchema, { minItems: 1, uniqueItems: true }),
  kdf: RecoveryKdfSchema,
  encryption: RecoveryEncryptionSchema,
} as const;

/**
 * Timestamps required by a given delivery state, mirroring the schema's
 * conditional `allOf`. Encoding them per pair means the type itself refuses a
 * `download-consumed` kit with no `downloadConsumedAt`.
 */
const OptionalDateTime = Type.Optional(Type.String({ format: "date-time" }));
const RequiredDateTime = Type.String({ format: "date-time" });

function recoveryKitVariant(pair: RecoveryStatePair) {
  const needsDownloadWindow =
    pair.deliveryState === "prepared" ||
    pair.deliveryState === "downloadable" ||
    pair.deliveryState === "download-consumed" ||
    pair.deliveryState === "expired";

  return Type.Object(
    {
      ...RecoveryKitCommonProperties,
      authorizationState: Type.Literal(pair.authorizationState),
      deliveryState: Type.Literal(pair.deliveryState),
      downloadExpiresAt: needsDownloadWindow ? RequiredDateTime : OptionalDateTime,
      downloadConsumedAt:
        pair.deliveryState === "download-consumed" ? RequiredDateTime : OptionalDateTime,
      confirmedAt: pair.deliveryState === "confirmed" ? RequiredDateTime : OptionalDateTime,
    },
    { additionalProperties: false },
  );
}

/** A union over exactly the seven legal pairs. */
export const RecoveryKitSchema = Type.Union(RECOVERY_STATE_PAIRS.map(recoveryKitVariant));
export type RecoveryKit = Static<typeof RecoveryKitSchema>;

// ---------------------------------------------------------------------------
// Rotation manifest
// ---------------------------------------------------------------------------

export const ROTATION_FORMAT = "myownnotion.rotation+json" as const;

export const RotationKinds = ["wrapping-key", "data-key"] as const;
export const RotationModes = ["scheduled", "emergency"] as const;
export const RotationPhases = [
  "planned",
  "prepared",
  "rewrapping",
  "rewriting",
  "committing",
  "complete",
  "failed",
] as const;
export type RotationPhase = (typeof RotationPhases)[number];

export const RotationManifestSchema = Type.Object(
  {
    format: Type.Literal(ROTATION_FORMAT),
    formatVersion: Type.Literal(1),
    operationId: ArtifactUuidSchema,
    installationId: ArtifactUuidSchema,
    kind: Type.Union(RotationKinds.map((kind) => Type.Literal(kind))),
    mode: Type.Union(RotationModes.map((mode) => Type.Literal(mode))),
    fromVersionOrGeneration: GenerationSchema,
    toVersionOrGeneration: GenerationSchema,
    phase: Type.Union(RotationPhases.map((phase) => Type.Literal(phase))),
    /** Resumable position; a restart continues here rather than restarting. */
    cursor: Type.String({ minLength: 1, maxLength: 512 }),
    processedCount: Type.Integer({ minimum: 0 }),
    totalCount: Type.Integer({ minimum: 0 }),
    auditReason: Type.Optional(Type.String({ maxLength: 256 })),
    checkpointDigest: Base64UrlOfBytes(B64_LENGTHS.digest),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export type RotationManifest = Static<typeof RotationManifestSchema>;

// ---------------------------------------------------------------------------
// Migration checkpoint
// ---------------------------------------------------------------------------

export const MIGRATION_FORMAT = "myownnotion.migration+json" as const;

/**
 * The staged plaintext-to-encrypted migration. Order matters: plaintext writes
 * stop before the read cutover, and scrubbing happens only after the cutover
 * has been verified.
 */
export const MigrationStates = MIGRATION_STATES;
export type MigrationState = (typeof MigrationStates)[number];

export const MigrationCheckpointSchema = Type.Object(
  {
    format: Type.Literal(MIGRATION_FORMAT),
    formatVersion: Type.Literal(1),
    migrationId: ArtifactUuidSchema,
    installationId: ArtifactUuidSchema,
    state: Type.Union(MigrationStates.map((state) => Type.Literal(state))),
    sourceCursor: Type.String({ minLength: 1, maxLength: 512 }),
    destinationCursor: Type.String({ minLength: 1, maxLength: 512 }),
    batchCount: Type.Integer({ minimum: 0 }),
    sourceCount: Type.Integer({ minimum: 0 }),
    destinationCount: Type.Integer({ minimum: 0 }),
    /** Digest over the canonical feature-001 identities carried across. */
    identityDigest: Base64UrlOfBytes(B64_LENGTHS.digest),
    checkpointDigest: Base64UrlOfBytes(B64_LENGTHS.digest),
    /** Set when a fault interrupted this checkpoint, for resume diagnostics. */
    faultPoint: Type.Optional(Type.String({ maxLength: 128 })),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export type MigrationCheckpoint = Static<typeof MigrationCheckpointSchema>;

// ---------------------------------------------------------------------------
// Pending bootstrap credential material
// ---------------------------------------------------------------------------

export const PENDING_BOOTSTRAP_CREDENTIAL_FORMAT = "myownnotion.bootstrap-credential+json" as const;

/**
 * Verified credential material held against one bootstrap attempt, before any
 * owner row exists. It is attempt-scoped on purpose: while this record is the
 * only thing that exists, the installation still reports `ownerCount=0` and
 * `workspaceCount=0`. Only the atomic confirmation promotes it to a committed
 * owner credential.
 */
export const PendingBootstrapCredentialSchema = Type.Object(
  {
    format: Type.Literal(PENDING_BOOTSTRAP_CREDENTIAL_FORMAT),
    formatVersion: Type.Literal(1),
    attemptId: ArtifactUuidSchema,
    installationId: ArtifactUuidSchema,
    credentialKind: Type.Union([Type.Literal("passkey"), Type.Literal("password")]),
    /** Opaque credential identifier; never the credential itself. */
    credentialIdDigest: Base64UrlOfBytes(B64_LENGTHS.digest),
    /** Hash of the browser-held bootstrap capability, never the capability. */
    capabilityDigest: Base64UrlOfBytes(B64_LENGTHS.digest),
    verifiedAt: Type.String({ format: "date-time" }),
    /** Origin and RP ID the ceremony was bound to, echoed for verification. */
    origin: Type.String({ minLength: 1, maxLength: 512 }),
    relyingPartyId: Type.String({ minLength: 1, maxLength: 253 }),
    signCount: Type.Integer({ minimum: 0 }),
    userVerified: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type PendingBootstrapCredential = Static<typeof PendingBootstrapCredentialSchema>;

// ---------------------------------------------------------------------------
// Discriminated union over every artifact
// ---------------------------------------------------------------------------

export const SecurityArtifactSchema = Type.Union([
  EncryptedEnvelopeSchema,
  RecoveryKitSchema,
  RotationManifestSchema,
  MigrationCheckpointSchema,
]);
export type SecurityArtifact = Static<typeof SecurityArtifactSchema>;
