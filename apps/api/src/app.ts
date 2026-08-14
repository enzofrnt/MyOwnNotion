/**
 * Fastify composition (T017).
 *
 * Schema-first: every request is validated and every response serialized
 * against contract schemas. Errors leave as redacted problem documents.
 * The server binds to 127.0.0.1 only until authentication exists.
 */

import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import { ContentStore, FilesystemBlobStore } from "@myownnotion/blob-store";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  findCurrentGeneration,
  getOrCreateWorkspace,
} from "@myownnotion/database";
import { sessionPolicy } from "@myownnotion/domain";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { AppContext } from "./context.ts";
import { registerErrorHandling } from "./plugins/errors.ts";
import { registerLogging } from "./plugins/logging.ts";
import { registerAuthenticationRoutes } from "./routes/authentication.ts";
import { registerBootstrapRoutes } from "./routes/bootstrap.ts";
import { registerChangeRoutes } from "./routes/changes.ts";
import { registerDeviceRoutes } from "./routes/devices.ts";
import { registerExportRoutes } from "./routes/export.ts";
import { registerFileRoutes } from "./routes/files.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerInstallationRoutes } from "./routes/installation.ts";
import { registerItemRoutes } from "./routes/items.ts";
import { registerMutationBatchRoutes } from "./routes/mutation-batch.ts";
import { registerPageDocumentRoutes } from "./routes/page-documents.ts";
import { registerPlacementRoutes } from "./routes/placements.ts";
import { registerRelationshipRoutes } from "./routes/relationships.ts";
import { registerRevisionRoutes } from "./routes/revisions.ts";
import { registerRecoveryRoutes } from "./routes/security-recovery.ts";
import { registerRotationRoutes } from "./routes/security-rotation.ts";
import { registerSnapshotRoutes } from "./routes/snapshots.ts";
import { AuditService } from "./security/audit-service.ts";
import { resolvePrincipal } from "./security/authentication-hook.ts";
import { renderBootstrapKit } from "./security/bootstrap-kit.ts";
import { BootstrapService } from "./security/bootstrap-service.ts";
import { setSessionCookie } from "./security/cookie-policy.ts";
import { loadDeploymentKey } from "./security/deployment-key.ts";
import { DeviceService } from "./security/device-service.ts";
import { KeyHierarchy } from "./security/key-hierarchy.ts";
import { createOwnerPrincipalResolver } from "./security/owner-principal.ts";
import { ProtectedContent } from "./security/protected-content.ts";
import { ProtectedRecordService } from "./security/protected-record-service.ts";
import { RecoveryKitService } from "./security/recovery-kit-service.ts";
import {
  attachRequestContext,
  createRequestContext,
  updateRequestContext,
} from "./security/request-context.ts";
import { RotationPolicyService } from "./security/rotation-policy-service.ts";
import { RotationScheduler } from "./security/rotation-scheduler.ts";
import { loadSecurityConfig, type SecurityConfig } from "./security/security-config.ts";
import { SessionService } from "./security/session-service.ts";
import type { WebAuthnChallenge } from "./security/webauthn-service.ts";

export interface BuildAppOptions {
  readonly databaseUrl: string;
  readonly blobRoot: string;
  readonly logger?: boolean;
  /**
   * Security configuration. Omitted in the feature-001 contract harness, which
   * exercises content routes only; the security routes are registered only when
   * a configuration is present, so a harness cannot accidentally reach them
   * with a half-built context.
   */
  readonly security?: SecurityConfig;
  /** Injected so bootstrap timing is testable at exact instants. */
  readonly now?: () => Date;
  /**
   * Whether an unusable security configuration stops the process.
   *
   * Defaults to `NODE_ENV === "production"`. Injected rather than read
   * directly at the point of use so a test can exercise the refusal without
   * setting a global that leaks into every other test sharing the process —
   * which is exactly what happened the first time this was written.
   */
  readonly refuseWithoutSecurity?: boolean;
}

export interface BuiltApp {
  readonly app: FastifyInstance;
  readonly context: AppContext;
  readonly database: DatabaseHandle;
  /**
   * The key hierarchy, when the security layer is configured.
   *
   * Exposed so a rotation can be driven from a test without reaching into the
   * schema and reimplementing the unwrap. Nothing on the request path reads it
   * from here.
   */
  readonly keyHierarchy?: KeyHierarchy | undefined;
  close(): Promise<void>;
}

/**
 * The installation identity is fixed per deployment. It is a constant rather
 * than a generated value so a restart cannot mint a second installation.
 */
const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";

/**
 * Loads the security configuration, or refuses to start.
 *
 * **In production a refused configuration stops the process.** Continuing
 * without one is not a degraded mode: the installation, bootstrap,
 * authentication, and session routes are simply absent, so the workspace is
 * open to anyone who can reach it. The failure is also invisible — the process
 * listens, `/health` answers 200, the container healthcheck goes green, and
 * the first symptom is a 404 on login that looks like a routing bug rather
 * than an unprotected deployment.
 *
 * That is not hypothetical: the shipped Compose defaults produced exactly this
 * state. `MYOWNNOTION_PUBLIC_ORIGIN` defaulted to an `http://` loopback origin
 * while `MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE` defaulted to `0`, which
 * `loadSecurityConfig` correctly refuses — and the refusal was swallowed into
 * a warning nobody reads in a container that reports itself healthy.
 *
 * Outside production it still returns null, because the feature-001 contract
 * harness builds the app deliberately without a security configuration and
 * must keep working.
 */
function tryLoadSecurityConfig(
  log: FastifyBaseLogger,
  refuseToStart: boolean,
): SecurityConfig | null {
  try {
    return loadSecurityConfig();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (refuseToStart) {
      log.fatal(
        { reason },
        "refusing to start: the security configuration is invalid, and serving without one would leave this workspace unprotected",
      );
      throw error;
    }
    log.warn(
      { reason },
      "security configuration was refused; installation, bootstrap, authentication, and session routes are NOT registered",
    );
    return null;
  }
}

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const database = createDatabase(options.databaseUrl);
  try {
    return await composeApp(options, database);
  } catch (error) {
    // The pool is open by now. Leaving it behind on a failed build leaks a
    // connection for the lifetime of the process — and in a test run, keeps a
    // client attached to a container that is about to stop, which surfaces as
    // an unhandled 57P01 long after the real failure.
    await database.close();
    throw error;
  }
}

async function composeApp(options: BuildAppOptions, database: DatabaseHandle): Promise<BuiltApp> {
  const workspace = await getOrCreateWorkspace(database.db);
  const contentStore = new ContentStore(new FilesystemBlobStore(options.blobRoot));

  /**
   * Set only when the security layer is configured.
   *
   * Undefined leaves feature-001 exactly as it was, which is what the
   * feature-001 contract harness relies on: it builds the app without a
   * security configuration and must not suddenly need a deployment key to
   * write a page.
   */
  let protectedContent: ProtectedContent | undefined;
  /** Set with the rest of the security layer; absent leaves feature-001 alone. */
  let rotationPolicies: RotationPolicyService | undefined;
  let keyHierarchy: KeyHierarchy | undefined;

  const context: AppContext = {
    db: database.db,
    workspaceId: workspace.id,
    schemaVersion: workspace.schemaVersion,
    contentStore,
    get rotationPolicies() {
      return rotationPolicies;
    },
    get protectedContent() {
      // A getter, because the security block that assigns it runs after this
      // object is built and the content routes read it per request.
      return protectedContent;
    },
  };

  const app = Fastify({
    logger: options.logger === false ? false : registerLogging(),
    bodyLimit: 64 * 1024 * 1024,
  });
  await app.register(multipart, {
    limits: { fileSize: 256 * 1024 * 1024, files: 1 },
  });
  // Every request gets a security context before any route runs, including
  // anonymous and rejected ones: the correlation ID it carries is the only
  // bridge between a redacted client problem and the unredacted server log,
  // and creating it lazily would leave exactly the failures an operator most
  // needs to trace without one.
  app.addHook("onRequest", async (request) => {
    attachRequestContext(request, createRequestContext());
  });

  registerErrorHandling(app);
  registerHealthRoutes(app, context);

  // Security surface. `loadSecurityConfig` throws on an incoherent
  // configuration, so a harness that does not supply one gets the content
  // routes alone rather than a partially wired security layer.
  const securityConfig =
    options.security ??
    tryLoadSecurityConfig(
      app.log,
      options.refuseWithoutSecurity ?? process.env["NODE_ENV"] === "production",
    );
  if (securityConfig !== null) {
    // The installation row must exist before anything can claim a bootstrap
    // attempt against it. Creating it here mirrors how feature 001 ensures the
    // canonical workspace, and it is idempotent: a restart, or two processes
    // starting at once, both find the existing row rather than minting a
    // second installation. It creates no owner, so the installation is still
    // `uninitialized` and still reports `0/0`.
    await createInstallation(database.db, {
      id: INSTALLATION_ID,
      sourceLineageId: INSTALLATION_ID,
      schemaVersion: workspace.schemaVersion,
    });
    registerInstallationRoutes(app, { db: database.db, config: securityConfig });
    const audit = new AuditService(database.db, { logger: app.log });
    const now = options.now ?? (() => new Date());

    /**
     * Reads the deployment wrapping key on demand rather than caching it.
     *
     * The key can become unavailable while the process runs — an unmounted
     * secret, a permission change — and a cached copy would keep authorizing
     * protected work long after the operator revoked access to it.
     */
    const deploymentKey = (): Buffer | null => {
      try {
        return Buffer.from(loadDeploymentKey(securityConfig.deploymentKeyFile).bytes);
      } catch {
        return null;
      }
    };

    // The key hierarchy is deliberately *not* established here.
    //
    // Establishing it at startup collided with the bootstrap promotion, which
    // mints the owner's first data key inside its atomic transaction: startup
    // inserted generation 1, the promotion's own insert then violated the
    // unique index, and confirming setup failed outright. It also could not
    // help an installation whose ownership arrives after the process started,
    // which is every one of them.
    //
    // `dataKey` creates it on the first protected write instead. See the
    // comment there.
    keyHierarchy = new KeyHierarchy({
      db: database.db,
      installationId: INSTALLATION_ID,
      workspaceId: workspace.id,
      deploymentKey,
      now,
    });

    // One policy object, shared by the service and the routes. Two calls would
    // be two objects that could drift the moment the policy takes an argument.
    const policy = sessionPolicy();
    const sessionService = new SessionService({
      db: database.db,
      audit,
      installationId: INSTALLATION_ID,
      policy,
      now,
    });

    // Registered before the routes so every handler sees a resolved principal.
    app.addHook("onRequest", async (request) => {
      const outcome = await resolvePrincipal(request, [
        createOwnerPrincipalResolver({ sessions: sessionService, config: securityConfig }),
      ]);
      if (outcome.authenticated) {
        updateRequestContext(request, { principal: outcome.principal });
      }
    });

    // Available to the content routes through the context, so a feature-001
    // route can seal its payload without knowing anything about key
    // generations. Absent when security is not configured, which is what keeps
    // the feature-001 harness behaving exactly as it did.
    protectedContent = new ProtectedContent({
      records: new ProtectedRecordService({
        db: database.db,
        keys: keyHierarchy,
        installationId: INSTALLATION_ID,
        workspaceId: workspace.id,
        now,
        // A refused envelope is the one integrity signal an operator cannot
        // reconstruct afterwards: the request is answered with an opaque
        // refusal and nothing is left behind. `AuditService.record` swallows
        // its own failures, so recording can never turn the refusal into a
        // different error.
        reportIntegrityFailure: async (failure) => {
          await audit.record(
            {
              installationId: INSTALLATION_ID,
              workspaceId: workspace.id,
              // No request is in scope here — this is reached from inside a
              // repository read — so the event carries its own correlation id
              // rather than borrowing one it cannot verify.
              correlationId: randomUUID(),
              actorClass: "system",
            },
            {
              eventType: "integrity.envelope-rejected",
              outcome: "failure",
              objectKind: failure.entityType,
              objectId: failure.entityId,
              // Reason, generation and version only. No ciphertext, no key,
              // no opened bytes — the audit trail must stay safe to read.
              metadata: {
                reason: failure.reason,
                keyGeneration: failure.keyGeneration,
                recordVersion: failure.recordVersion,
              },
            },
          );
        },
      }),
    });

    const requireOwner = registerAuthenticationRoutes(app, {
      db: database.db,
      config: securityConfig,
      sessions: sessionService,
      audit,
      installationId: INSTALLATION_ID,
      deploymentKey,
      policy,
      now,
      challenges: new Map<string, WebAuthnChallenge>(),
    });

    // The device inventory shares the authentication gate rather than building
    // its own: one idea of what "recent" and "valid CSRF" mean, for the routes
    // an owner reaches for when they suspect someone else has access.
    // Rotation: status is readable by any signed-in owner, starting one needs
    // a fresh proof. The scheduler evaluates at startup so an overdue key is
    // reported by a restart rather than only by a timer the process may never
    // reach.
    rotationPolicies = new RotationPolicyService({
      db: database.db,
      installationId: INSTALLATION_ID,
      now,
    });
    registerRotationRoutes(app, {
      db: database.db,
      policies: rotationPolicies,
      audit,
      installationId: INSTALLATION_ID,
      now,
      require: requireOwner,
    });
    void new RotationScheduler({
      policies: rotationPolicies,
      logger: app.log,
      // Audited from the evaluation rather than from the write path: one row
      // per refused write would bury the event under thousands of copies of
      // itself, exactly when an operator most needs to find it.
      onWriteBlocked: async (blocked) => {
        await audit.record(
          {
            installationId: INSTALLATION_ID,
            workspaceId: workspace.id,
            correlationId: randomUUID(),
            actorClass: "system",
          },
          {
            eventType: "rotation.write-blocked",
            outcome: "failure",
            objectKind: "rotation-policy",
            objectId: blocked.kind,
            metadata: {
              dueAt: blocked.dueAt.toISOString(),
              writeBlockAt: blocked.writeBlockAt.toISOString(),
            },
          },
        );
      },
    }).start();

    // Recovery-kit replacement. The payload is the workspace root key, taken
    // through the hierarchy's one named export rather than a general accessor,
    // and the kit is sealed under the mounted deployment key — so the routes
    // need the key reader as well as the database.
    registerRecoveryRoutes(app, {
      kits: new RecoveryKitService({
        db: database.db,
        installationId: INSTALLATION_ID,
        sourceLineageId: INSTALLATION_ID,
        workspaceId: workspace.id,
        deploymentKey,
        supportedKeyGenerations: async () => {
          const current = await findCurrentGeneration(database.db, workspace.id);
          // Every generation up to the current one, because a restored
          // installation has to open records written under any of them. An
          // empty list means the hierarchy was never established, and the
          // service refuses rather than sealing a kit that opens nothing.
          return current === null
            ? []
            : Array.from({ length: current.generation }, (_, index) => index + 1);
        },
        recoveryPayload: async () => {
          if (keyHierarchy === undefined) {
            // Unreachable from this branch — the hierarchy is built above —
            // but the service must fail closed rather than seal an empty kit
            // if that ever stops being true.
            throw new Error("the key hierarchy is unavailable");
          }
          return await keyHierarchy.exportRecoveryMaterial(database.db);
        },
        now,
      }),
      audit,
      installationId: INSTALLATION_ID,
      require: requireOwner,
    });

    registerDeviceRoutes(app, {
      devices: new DeviceService({ db: database.db, now }),
      audit,
      installationId: INSTALLATION_ID,
      require: requireOwner,
    });

    const bootstrap = new BootstrapService({
      db: database.db,
      config: securityConfig,
      audit,
      installationId: INSTALLATION_ID,
      workspaceId: workspace.id,
      workspaceSchemaVersion: workspace.schemaVersion,
      sealFirstDataKey: async () => {
        if (keyHierarchy === undefined) {
          throw new Error("the key hierarchy is unavailable; setup cannot be completed");
        }
        return await keyHierarchy.sealFirstDataKey(database.db);
      },
      now: options.now ?? (() => new Date()),
      challenges: new Map<string, WebAuthnChallenge>(),
    });
    registerBootstrapRoutes(app, {
      service: bootstrap,
      // The artifact lives in `bootstrap-kit.ts`, not here. It is the only
      // path that produces the file an owner is told to keep forever, and code
      // that only runs from a composition root is code only ever exercised by
      // accident.
      renderKit: async (kitId) =>
        JSON.stringify(
          await renderBootstrapKit(
            {
              db: database.db,
              installationId: INSTALLATION_ID,
              workspaceId: workspace.id,
              keys: keyHierarchy,
              deploymentKey,
              now,
            },
            kitId,
          ),
        ),
      // Setup ends signed in: the owner just proved possession, and a
      // sign-in screen immediately afterwards reads as the ceremony having
      // failed.
      startSession: async ({ reply, ownerId, deviceId, correlationId }) => {
        const issued = await sessionService.issue({
          ownerId,
          deviceId,
          authMethod: "passkey",
          correlationId,
        });
        setSessionCookie(
          reply,
          securityConfig,
          issued.secret,
          Math.max(0, Math.floor((issued.session.expiresAt.getTime() - now().getTime()) / 1000)),
        );
      },
    });
  }
  registerItemRoutes(app, context);
  registerPlacementRoutes(app, context);
  registerPageDocumentRoutes(app, context);
  registerFileRoutes(app, context);
  registerRelationshipRoutes(app, context);
  registerRevisionRoutes(app, context);
  registerChangeRoutes(app, context);
  registerSnapshotRoutes(app, context);
  registerMutationBatchRoutes(app, context);
  registerExportRoutes(app, context);

  return {
    app,
    context,
    database,
    keyHierarchy,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}
