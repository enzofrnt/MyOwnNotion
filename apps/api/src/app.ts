/**
 * Fastify composition (T017).
 *
 * Schema-first: every request is validated and every response serialized
 * against contract schemas. Errors leave as redacted problem documents.
 * The server binds to 127.0.0.1 only until authentication exists.
 */

import multipart from "@fastify/multipart";
import { ContentStore, FilesystemBlobStore } from "@myownnotion/blob-store";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
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
import { registerSnapshotRoutes } from "./routes/snapshots.ts";
import { AuditService } from "./security/audit-service.ts";
import { resolvePrincipal } from "./security/authentication-hook.ts";
import { BootstrapService } from "./security/bootstrap-service.ts";
import { setSessionCookie } from "./security/cookie-policy.ts";
import { loadDeploymentKey } from "./security/deployment-key.ts";
import { KeyHierarchy } from "./security/key-hierarchy.ts";
import { createOwnerPrincipalResolver } from "./security/owner-principal.ts";
import { ProtectedContent } from "./security/protected-content.ts";
import { ProtectedRecordService } from "./security/protected-record-service.ts";
import {
  attachRequestContext,
  createRequestContext,
  updateRequestContext,
} from "./security/request-context.ts";
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
}

export interface BuiltApp {
  readonly app: FastifyInstance;
  readonly context: AppContext;
  readonly database: DatabaseHandle;
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
function tryLoadSecurityConfig(log: FastifyBaseLogger): SecurityConfig | null {
  try {
    return loadSecurityConfig();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (process.env["NODE_ENV"] === "production") {
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

  const context: AppContext = {
    db: database.db,
    workspaceId: workspace.id,
    schemaVersion: workspace.schemaVersion,
    contentStore,
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
  const securityConfig = options.security ?? tryLoadSecurityConfig(app.log);
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
    const keys = new KeyHierarchy({
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
        keys,
        installationId: INSTALLATION_ID,
        workspaceId: workspace.id,
        now,
      }),
    });

    registerAuthenticationRoutes(app, {
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

    const bootstrap = new BootstrapService({
      db: database.db,
      config: securityConfig,
      audit,
      installationId: INSTALLATION_ID,
      workspaceId: workspace.id,
      workspaceSchemaVersion: workspace.schemaVersion,
      now: options.now ?? (() => new Date()),
      challenges: new Map<string, WebAuthnChallenge>(),
    });
    registerBootstrapRoutes(app, {
      service: bootstrap,
      // The kit artifact is streamed, never colocated with workspace data.
      renderKit: async (kitId) =>
        JSON.stringify({ format: "myownnotion.recovery+json", formatVersion: 1, kitId }),
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
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}
