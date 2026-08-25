/**
 * Security API DTOs and runtime validators (T013, feature 002).
 *
 * Executable mirror of
 * `specs/002-owner-security-foundation/contracts/security-api.openapi.yaml`.
 * `tests/contract/security-api.spec.ts` keeps the two aligned; Fastify
 * validates every request and serializes every response against these.
 *
 * Three properties are encoded structurally rather than left to convention,
 * because each is a place where a mistake is a security defect:
 *
 *   1. **Committed counts are constants, not free integers.** An uninitialized
 *      status *cannot* express `ownerCount: 1`, and an initialized one cannot
 *      express `0`. The status endpoint therefore cannot report a partial
 *      installation even if a service tried to.
 *   2. **Response-only material is typed as response-only.** The bootstrap
 *      capability and the CSRF token appear in response bodies and are echoed
 *      only in `X-Bootstrap-Capability` / `X-CSRF-Token` request headers.
 *      There is no request DTO with a field for either, so a route cannot
 *      accept one in a body or a query string.
 *   3. **Device activity timestamps are nullable and required.** `null` means
 *      the event has not happened yet; omitting the field would be
 *      indistinguishable from "not implemented", and synthesizing a value
 *      would claim activity that never occurred.
 */

import {
  INITIALIZED_INSTALLATION_STATES,
  INSTALLATION_STATES,
  KEY_KINDS,
  KEY_POLICY_STATES,
  MIGRATION_STATES,
  RECOVERY_AUTHORIZATION_STATES,
  RECOVERY_DELIVERY_STATES,
  ROTATION_MODES,
} from "@myownnotion/domain";
import { type Static, Type } from "@sinclair/typebox";

const literals = <T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)));

export const SecurityUuidSchema = Type.String({ format: "uuid" });
const DateTime = Type.String({ format: "date-time" });
const NullableDateTime = Type.Union([DateTime, Type.Null()]);

// ---------------------------------------------------------------------------
// Response-only material
// ---------------------------------------------------------------------------

/**
 * Header names the browser may echo response-only values back through.
 *
 * Headers, never a URL or a body: a value in a query string lands in server
 * logs, browser history, and `Referer`, all of which outlive the session.
 */
export const BOOTSTRAP_CAPABILITY_HEADER = "x-bootstrap-capability" as const;
export const CSRF_TOKEN_HEADER = "x-csrf-token" as const;

/**
 * The browser-held bootstrap capability. Marked `readOnly`, so it is part of
 * responses and of no request body. Regeneration reuses the same capability
 * against the same verified `attemptId`.
 */
export const BootstrapCapabilitySchema = Type.String({
  minLength: 32,
  maxLength: 512,
  readOnly: true,
});

/** 32 bytes as unpadded base64url. */
export const CsrfTokenSchema = Type.String({ minLength: 43, maxLength: 43, readOnly: true });

// ---------------------------------------------------------------------------
// Health and installation status
// ---------------------------------------------------------------------------

export const HealthSchema = Type.Object(
  {
    status: Type.Literal("ready"),
    schemaVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type HealthDto = Static<typeof HealthSchema>;

export const MigrationStatusSchema = Type.Object(
  {
    migrationId: SecurityUuidSchema,
    state: literals(MIGRATION_STATES),
    sourceRetained: Type.Boolean(),
    plaintextWrites: Type.Union([Type.Literal("enabled"), Type.Literal("stopped")]),
    encryptedReads: Type.Union([Type.Literal("disabled"), Type.Literal("enabled")]),
    sourceCount: Type.Optional(Type.Integer({ minimum: 0 })),
    destinationCount: Type.Optional(Type.Integer({ minimum: 0 })),
    identityDigest: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    lastSafeCheckpoint: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { additionalProperties: false },
);
export type MigrationStatusDto = Static<typeof MigrationStatusSchema>;

export const RotationPolicyViewSchema = Type.Object(
  {
    kind: literals(KEY_KINDS),
    state: literals(KEY_POLICY_STATES),
    dueAt: DateTime,
    writeBlockAt: DateTime,
    lastCompletedAt: NullableDateTime,
    currentVersionOrGeneration: Type.Integer({ minimum: 1 }),
    nextAction: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export type RotationPolicyViewDto = Static<typeof RotationPolicyViewSchema>;

const installationStatusCommon = {
  recoveryReady: Type.Boolean(),
  securityReady: Type.Boolean(),
  wrappingPolicy: Type.Optional(RotationPolicyViewSchema),
  dataKeyPolicy: Type.Optional(RotationPolicyViewSchema),
  migration: Type.Optional(MigrationStatusSchema),
} as const;

/**
 * Uninitialized statuses pin the counts to `0`. The type has no way to say
 * otherwise, so a service bug cannot make the endpoint claim an owner exists
 * while bootstrap is still in progress.
 */
export const UninitializedInstallationStatusSchema = Type.Object(
  {
    ...installationStatusCommon,
    state: Type.Literal("uninitialized"),
    ownerCount: Type.Literal(0),
    workspaceCount: Type.Literal(0),
  },
  { additionalProperties: false },
);

export const BootstrapInProgressInstallationStatusSchema = Type.Object(
  {
    ...installationStatusCommon,
    state: Type.Literal("bootstrap-in-progress"),
    ownerCount: Type.Literal(0),
    workspaceCount: Type.Literal(0),
  },
  { additionalProperties: false },
);

/** Every initialized state is `1/1`, `degraded` included. */
export const InitializedInstallationStatusSchema = Type.Object(
  {
    ...installationStatusCommon,
    state: literals(INITIALIZED_INSTALLATION_STATES),
    ownerCount: Type.Literal(1),
    workspaceCount: Type.Literal(1),
  },
  { additionalProperties: false },
);

export const InstallationStatusSchema = Type.Union([
  UninitializedInstallationStatusSchema,
  BootstrapInProgressInstallationStatusSchema,
  InitializedInstallationStatusSchema,
]);
export type InstallationStatusDto = Static<typeof InstallationStatusSchema>;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export const BootstrapStartSchema = Type.Object(
  { clientNonce: Type.String({ minLength: 22, maxLength: 128 }) },
  { additionalProperties: false },
);
export type BootstrapStartDto = Static<typeof BootstrapStartSchema>;

export const BootstrapStartedSchema = Type.Object(
  {
    attemptId: SecurityUuidSchema,
    capability: BootstrapCapabilitySchema,
    expiresAt: DateTime,
    challenge: Type.String({ minLength: 22 }),
    bootstrapState: Type.Literal("started"),
    installationState: Type.Literal("uninitialized"),
    ownerCount: Type.Literal(0),
    workspaceCount: Type.Literal(0),
  },
  { additionalProperties: false },
);
export type BootstrapStartedDto = Static<typeof BootstrapStartedSchema>;

export const WebAuthnOptionsSchema = Type.Object(
  { challenge: Type.String({ minLength: 22 }) },
  { additionalProperties: true },
);
export type WebAuthnOptionsDto = Static<typeof WebAuthnOptionsSchema>;

export const WebAuthnAssertionSchema = Type.Object(
  {
    id: Type.String(),
    rawId: Type.String(),
    type: Type.Literal("public-key"),
    response: Type.Object(
      {
        clientDataJSON: Type.String(),
        authenticatorData: Type.String(),
        signature: Type.String(),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
);
export type WebAuthnAssertionDto = Static<typeof WebAuthnAssertionSchema>;

/**
 * Stable, non-secret identity of one browser profile.
 *
 * It is attribution, not authentication: routes accept it only after a valid
 * owner credential. The `web-` prefix keeps browser bindings distinct from
 * future native-client namespaces without leaking any platform identifier.
 */
export const BrowserDeviceClaimSchema = Type.Object(
  {
    deviceBindingId: Type.String({
      minLength: 40,
      maxLength: 40,
      pattern: "^web-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    platform: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type BrowserDeviceClaimDto = Static<typeof BrowserDeviceClaimSchema>;

export const PasskeyLoginSchema = Type.Object(
  {
    credential: WebAuthnAssertionSchema,
    device: BrowserDeviceClaimSchema,
  },
  { additionalProperties: false },
);
export type PasskeyLoginDto = Static<typeof PasskeyLoginSchema>;

export const BootstrapCredentialVerificationSchema = Type.Object(
  { credential: WebAuthnAssertionSchema },
  { additionalProperties: false },
);
export type BootstrapCredentialVerificationDto = Static<
  typeof BootstrapCredentialVerificationSchema
>;

/**
 * Progress while the attempt is still attempt-scoped.
 *
 * The two variants pair `bootstrapState` with the delivery states it can
 * legally be in, so a `download-consumed` attempt cannot report itself as
 * still `downloadable` — that pairing is what makes the one-time download
 * observable from the outside.
 */
const bootstrapProgressCommon = {
  attemptId: SecurityUuidSchema,
  recoveryKitId: SecurityUuidSchema,
  authorizationState: Type.Literal("provisional"),
  downloadExpiresAt: DateTime,
  installationState: Type.Literal("uninitialized"),
  ownerCount: Type.Literal(0),
  workspaceCount: Type.Literal(0),
} as const;

export const BootstrapProgressSchema = Type.Union([
  Type.Object(
    {
      ...bootstrapProgressCommon,
      bootstrapState: Type.Literal("recovery-prepared"),
      deliveryState: Type.Union([Type.Literal("prepared"), Type.Literal("downloadable")]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...bootstrapProgressCommon,
      bootstrapState: Type.Literal("download-consumed"),
      deliveryState: Type.Literal("download-consumed"),
    },
    { additionalProperties: false },
  ),
]);
export type BootstrapProgressDto = Static<typeof BootstrapProgressSchema>;

/** Offline confirmation is an explicit act; `true` is the only accepted value. */
export const OfflineConfirmationSchema = Type.Object(
  { storedOffline: Type.Literal(true) },
  { additionalProperties: false },
);
export type OfflineConfirmationDto = Static<typeof OfflineConfirmationSchema>;

/** Bootstrap also establishes the first durable browser-device binding. */
export const BootstrapOfflineConfirmationSchema = Type.Object(
  { storedOffline: Type.Literal(true), device: BrowserDeviceClaimSchema },
  { additionalProperties: false },
);
export type BootstrapOfflineConfirmationDto = Static<typeof BootstrapOfflineConfirmationSchema>;

/**
 * The single response shape that proves the atomic promotion happened: the
 * attempt is `confirmed`, the installation is `ready`, the counts are `1/1`,
 * and the kit reached `active/confirmed`. Every field is a constant, so this
 * response cannot be produced by a partially completed bootstrap.
 */
export const BootstrapConfirmationResultSchema = Type.Object(
  {
    attemptId: SecurityUuidSchema,
    bootstrapState: Type.Literal("confirmed"),
    installationState: Type.Literal("ready"),
    ownerCount: Type.Literal(1),
    workspaceCount: Type.Literal(1),
    authorizationState: Type.Literal("active"),
    deliveryState: Type.Literal("confirmed"),
  },
  { additionalProperties: false },
);
export type BootstrapConfirmationResultDto = Static<typeof BootstrapConfirmationResultSchema>;

// ---------------------------------------------------------------------------
// Credentials, sessions, devices
// ---------------------------------------------------------------------------

export const PasskeyEnrollmentCompletionSchema = Type.Intersect([
  WebAuthnAssertionSchema,
  Type.Object({ label: Type.String({ minLength: 1, maxLength: 120 }) }),
]);
export type PasskeyEnrollmentCompletionDto = Static<typeof PasskeyEnrollmentCompletionSchema>;

export const PasskeyViewSchema = Type.Object(
  {
    credentialId: Type.String(),
    label: Type.String({ minLength: 1, maxLength: 120 }),
    state: Type.Union([Type.Literal("pending"), Type.Literal("active"), Type.Literal("revoked")]),
    createdAt: DateTime,
  },
  { additionalProperties: false },
);
export type PasskeyViewDto = Static<typeof PasskeyViewSchema>;

/** `writeOnly`: a password is accepted and never returned. */
export const PasswordChangeSchema = Type.Object(
  { newPassword: Type.String({ minLength: 12, maxLength: 1024, writeOnly: true }) },
  { additionalProperties: false },
);
export type PasswordChangeDto = Static<typeof PasswordChangeSchema>;

export const PasswordLoginSchema = Type.Object(
  {
    password: Type.String({ minLength: 12, maxLength: 1024, writeOnly: true }),
    device: BrowserDeviceClaimSchema,
  },
  { additionalProperties: false },
);
export type PasswordLoginDto = Static<typeof PasswordLoginSchema>;

export const PasswordViewSchema = Type.Object(
  {
    configured: Type.Boolean(),
    state: Type.Union([
      Type.Literal("active"),
      Type.Literal("superseded"),
      Type.Literal("revoked"),
    ]),
    createdAt: DateTime,
  },
  { additionalProperties: false },
);
export type PasswordViewDto = Static<typeof PasswordViewSchema>;

export const SessionViewSchema = Type.Object(
  {
    sessionId: SecurityUuidSchema,
    deviceId: SecurityUuidSchema,
    // The protected local CLI never creates a session, so it is never a method.
    authMethod: Type.Union([Type.Literal("passkey"), Type.Literal("password")]),
    issuedAt: DateTime,
    lastSeenAt: DateTime,
    expiresAt: DateTime,
    state: Type.Union([Type.Literal("active"), Type.Literal("revoked"), Type.Literal("expired")]),
  },
  { additionalProperties: false },
);
export type SessionViewDto = Static<typeof SessionViewSchema>;

/** The CSRF token is returned once, alongside the session it protects. */
export const AuthenticatedSessionSchema = Type.Object(
  { session: SessionViewSchema, csrfToken: CsrfTokenSchema },
  { additionalProperties: false },
);
export type AuthenticatedSessionDto = Static<typeof AuthenticatedSessionSchema>;

export const DeviceSchema = Type.Object(
  {
    deviceId: SecurityUuidSchema,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    platform: Type.String({ minLength: 1, maxLength: 64 }),
    clientType: Type.Literal("web"),
    authorizedAt: DateTime,
    /**
     * Required and nullable. `null` until a real authenticated activity event
     * commits; registration, rename, and inventory reads must never
     * synthesize it. Making it optional would make "no activity yet"
     * indistinguishable from "this field is not implemented".
     */
    lastActivityAt: NullableDateTime,
    /** Same rule, for the first successful synchronization. */
    lastSyncAt: NullableDateTime,
    state: Type.Union([
      Type.Literal("pending"),
      Type.Literal("active"),
      Type.Literal("revoked"),
      Type.Literal("reauthorization-required"),
    ]),
    localStorageLimitBytes: Type.Integer({ minimum: 1 }),
    localUsageBytes: Type.Integer({ minimum: 0 }),
    keyProtection: Type.Optional(
      Type.Union([
        Type.Literal("platform-secure-storage"),
        Type.Literal("browser-non-exportable"),
        Type.Literal("unavailable"),
      ]),
    ),
  },
  { additionalProperties: false },
);
export type DeviceDto = Static<typeof DeviceSchema>;

export const DeviceUpdateSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    localStorageLimitBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type DeviceUpdateDto = Static<typeof DeviceUpdateSchema>;

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export const RecoveryKitPrepareSchema = Type.Object(
  { passphrase: Type.String({ minLength: 12, maxLength: 1024, writeOnly: true }) },
  { additionalProperties: false },
);
export type RecoveryKitPrepareDto = Static<typeof RecoveryKitPrepareSchema>;

export const RecoveryKitDownloadViewSchema = Type.Object(
  {
    kitId: SecurityUuidSchema,
    format: Type.Literal("myownnotion.recovery+json"),
    formatVersion: Type.Literal(1),
    installationId: SecurityUuidSchema,
    sourceLineageId: SecurityUuidSchema,
    authorizationState: Type.Literal("provisional"),
    deliveryState: Type.Union([Type.Literal("downloadable"), Type.Literal("download-consumed")]),
    downloadExpiresAt: DateTime,
  },
  { additionalProperties: false },
);
export type RecoveryKitDownloadViewDto = Static<typeof RecoveryKitDownloadViewSchema>;

/** The seven legal pairs, same as the artifact schema and the database. */
export const RECOVERY_VIEW_STATE_PAIRS = [
  { authorizationState: "provisional", deliveryState: "prepared" },
  { authorizationState: "provisional", deliveryState: "downloadable" },
  { authorizationState: "provisional", deliveryState: "download-consumed" },
  { authorizationState: "active", deliveryState: "confirmed" },
  { authorizationState: "superseded", deliveryState: "confirmed" },
  { authorizationState: "revoked", deliveryState: "confirmed" },
  { authorizationState: "rejected", deliveryState: "expired" },
] as const;

const recoveryKitViewCommon = {
  kitId: SecurityUuidSchema,
  recoveryEpoch: Type.Integer({ minimum: 1 }),
  sourceLineageId: SecurityUuidSchema,
  createdAt: DateTime,
  supportedKeyGenerations: Type.Array(Type.Integer({ minimum: 1 }), {
    minItems: 1,
    uniqueItems: true,
  }),
} as const;

export const RecoveryKitViewSchema = Type.Union(
  RECOVERY_VIEW_STATE_PAIRS.map((pair) =>
    Type.Object(
      {
        ...recoveryKitViewCommon,
        authorizationState: Type.Literal(pair.authorizationState),
        deliveryState: Type.Literal(pair.deliveryState),
      },
      { additionalProperties: false },
    ),
  ),
);
export type RecoveryKitViewDto = Static<typeof RecoveryKitViewSchema>;

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

export const RotationStartSchema = Type.Object(
  {
    kind: literals(KEY_KINDS),
    mode: literals(ROTATION_MODES),
    reason: Type.String({ minLength: 1, maxLength: 256 }),
    dryRun: Type.Boolean(),
    /** Explicit, never defaulted: rotation rewrites data. */
    confirmation: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type RotationStartDto = Static<typeof RotationStartSchema>;

export const RotationViewSchema = Type.Object(
  {
    operationId: SecurityUuidSchema,
    kind: literals(KEY_KINDS),
    mode: literals(ROTATION_MODES),
    phase: Type.Union(
      (
        [
          "planned",
          "prepared",
          "rewrapping",
          "rewriting",
          "committing",
          "complete",
          "failed",
        ] as const
      ).map((phase) => Type.Literal(phase)),
    ),
    fromVersionOrGeneration: Type.Integer({ minimum: 1 }),
    toVersionOrGeneration: Type.Integer({ minimum: 1 }),
    processedCount: Type.Integer({ minimum: 0 }),
    totalCount: Type.Integer({ minimum: 0 }),
    checkpointDigest: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    failureCode: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
  },
  { additionalProperties: false },
);
export type RotationViewDto = Static<typeof RotationViewSchema>;

// ---------------------------------------------------------------------------
// Audit and problems
// ---------------------------------------------------------------------------

export const AuditEventSchema = Type.Object(
  {
    eventId: SecurityUuidSchema,
    eventType: Type.String({ maxLength: 64 }),
    outcome: Type.Union([
      Type.Literal("success"),
      Type.Literal("failure"),
      Type.Literal("refused"),
      Type.Literal("started"),
    ]),
    actorClass: Type.Union([
      Type.Literal("owner"),
      Type.Literal("hosting-admin"),
      Type.Literal("system"),
    ]),
    correlationId: SecurityUuidSchema,
    safeCode: Type.String({ maxLength: 128 }),
    occurredAt: DateTime,
  },
  { additionalProperties: false },
);
export type AuditEventDto = Static<typeof AuditEventSchema>;

/**
 * The outward-facing problem. No message from the underlying error, no field
 * path, no identifier the caller did not already know — only a code and a
 * correlation ID an operator can use to find the unredacted server log.
 */
export const SecurityProblemSchema = Type.Object(
  {
    type: Type.String({ format: "uri-reference" }),
    title: Type.String({ maxLength: 120 }),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    code: Type.String({ maxLength: 128 }),
    correlationId: SecurityUuidSchema,
    detail: Type.Optional(Type.String({ maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type SecurityProblemDto = Static<typeof SecurityProblemSchema>;

// ---------------------------------------------------------------------------
// Vocabularies re-exported for route and test use
// ---------------------------------------------------------------------------

export const SECURITY_API_INSTALLATION_STATES = INSTALLATION_STATES;
export const SECURITY_API_RECOVERY_AUTHORIZATION_STATES = RECOVERY_AUTHORIZATION_STATES;
export const SECURITY_API_RECOVERY_DELIVERY_STATES = RECOVERY_DELIVERY_STATES;
