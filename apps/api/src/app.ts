import {
  findMcpWorkspace,
  McpAccessService,
  recordUnknownMcpCredential,
} from "./mcp/access-service.ts";
import { registerMcpHttp } from "./mcp/http.ts";
import { registerMcpManagementRoutes } from "./routes/mcp.ts";
import { requiresOwnerHttpAccess } from "./security/http-access.ts";
/**
 * Fastify composition (T017).
 *
 * Schema-first: every request is validated and every response serialized
 * against contract schemas. Errors leave as redacted problem documents.
 * The server binds to 127.0.0.1 only until authentication exists.
 */

import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { ContentStore, FilesystemBlobStore, PartialUploadStore } from "@myownnotion/blob-store";
import { MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES } from "@myownnotion/contracts";
import {
  CANONICAL_SCHEMA_VERSION,
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  findAccountById,
  findCurrentGeneration,
  findInstallation,
  getOrCreateWorkspace,
  listAccountWorkspaceIds,
  setWorkspaceFence,
} from "@myownnotion/database";
import { sessionPolicy, type Uuid } from "@myownnotion/domain";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import { restoreTestCommand } from "./admin/commands/restore-test.ts";
import { openBackupArchive } from "./backup/archive-crypto.ts";
import {
  createBackupDestination,
  fullBackupRoot,
  loadBackupConfig,
} from "./backup/backup-config.ts";
import { BACKUP_RECORD_FORMAT_VERSION } from "./backup/backup-service.ts";
import { assertFullRestoreActivated } from "./backup/full/restore-state.ts";
import { FullBackupService } from "./backup/full/service.ts";
import { PageOperationArchiveService } from "./backup/page-operation-archive.ts";
import type { AppContext } from "./context.ts";
import {
  createDatabaseQueryService,
  type DatabaseQueryService,
} from "./databases/database-query-service.ts";
import { startProtectedFileCleanup } from "./files/protected-file-cleanup.ts";
import { createProtectedFileRuntime } from "./files/protected-file-runtime.ts";
import type { ProtectedFileService } from "./files/protected-file-service.ts";
import { CanonicalMaterializer } from "./page-state/canonical-materializer.ts";
import {
  type PageCheckpointRetentionPolicy,
  PageCheckpointService,
} from "./page-state/checkpoint-service.ts";
import { LegacyBranchService } from "./page-state/legacy-branch-service.ts";
import { PageActivationService } from "./page-state/page-activation-service.ts";
import { PageAmbiguityService } from "./page-state/page-ambiguity-service.ts";
import { PageHistoryService } from "./page-state/page-history-service.ts";
import { PageOperationCrypto } from "./page-state/page-operation-crypto.ts";
import { PageOperationService } from "./page-state/page-operation-service.ts";
import { registerErrorHandling, sendSecurityProblem } from "./plugins/errors.ts";
import { registerLogging } from "./plugins/logging.ts";
import { registerProtocolAnnouncement } from "./plugins/protocol.ts";
import { PageAdvanceNotifier } from "./realtime/page-advance-notifier.ts";
import { PageSyncHub } from "./realtime/page-sync-hub.ts";
import { RealtimePageSyncObservability } from "./realtime/page-sync-observability.ts";
import { registerAccountRoutes } from "./routes/accounts.ts";
import { registerAuthenticationRoutes } from "./routes/authentication.ts";
import { registerBackupRoutes } from "./routes/backups.ts";
import { registerChangeStreamRoutes } from "./routes/change-stream.ts";
import { registerChangeRoutes } from "./routes/changes.ts";
import { registerDatabaseRoutes } from "./routes/databases.ts";
import { registerDeviceRoutes } from "./routes/devices.ts";
import { registerExportRoutes } from "./routes/export.ts";
import { registerFileRoutes } from "./routes/files.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerInstallationRoutes } from "./routes/installation.ts";
import { registerItemRoutes } from "./routes/items.ts";
import { registerMutationBatchRoutes } from "./routes/mutation-batch.ts";
import { registerPageDocumentRoutes } from "./routes/page-documents.ts";
import { registerPageOperationRoutes } from "./routes/page-operations.ts";
import { registerPageSyncSocketRoutes } from "./routes/page-sync-socket.ts";
import { registerPlacementRoutes } from "./routes/placements.ts";
import { registerPlaceRoutes } from "./routes/places.ts";
import { registerRelationshipRoutes } from "./routes/relationships.ts";
import { registerRevisionRoutes } from "./routes/revisions.ts";
import { registerSearchRoutes } from "./routes/search.ts";
import { registerSecurityAuditRoutes } from "./routes/security-audit.ts";
import { registerRecoveryRoutes } from "./routes/security-recovery.ts";
import { registerRotationRoutes } from "./routes/security-rotation.ts";
import { registerSnapshotRoutes } from "./routes/snapshots.ts";
import { maxFileBytes, registerUploadRoutes } from "./routes/uploads.ts";
import { createDatabaseSearchService, type SearchService } from "./search/search-service.ts";
import { AccountService } from "./security/account-service.ts";
import { AuditService } from "./security/audit-service.ts";
import { resolvePrincipal } from "./security/authentication-hook.ts";
import { loadDeploymentKey } from "./security/deployment-key.ts";
import { DeviceService } from "./security/device-service.ts";
import { assertStorageTransitionReady } from "./security/file-storage-transition-guard.ts";
import type { KeyHierarchy } from "./security/key-hierarchy.ts";
import { createOwnerPrincipalResolver } from "./security/owner-principal.ts";
import { checkRouteReadiness } from "./security/private-route-guard.ts";
import type { ProtectedContent } from "./security/protected-content.ts";
import { INSTALLATION_ID } from "./security/protected-content-runtime.ts";
import { isWebSocketUpgradeRequest } from "./security/realtime-authorization.ts";
import { RecoveryKitService } from "./security/recovery-kit-service.ts";
import {
  attachRequestContext,
  createRequestContext,
  type RequestPrincipal,
  requestContext,
  updateRequestContext,
} from "./security/request-context.ts";
import { RotationPolicyService } from "./security/rotation-policy-service.ts";
import { RotationScheduler } from "./security/rotation-scheduler.ts";
import { loadSecurityConfig, type SecurityConfig } from "./security/security-config.ts";
import { SessionService } from "./security/session-service.ts";
import type { WebAuthnChallenge } from "./security/webauthn-service.ts";
import {
  bindWorkspace,
  boundWorkspaceId,
  currentWorkspaceId,
  enterRequestScope,
  scoped,
  setUnsecuredFallbackWorkspace,
  WorkspaceScopeError,
} from "./workspace-scope.ts";

export interface BuildAppOptions {
  readonly databaseUrl: string;
  readonly blobRoot: string;
  readonly fullBackupRoot?: string;
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
  /**
   * Internal retention evidence used by checkpoint maintenance.
   *
   * Production deliberately defaults to deny: payload compaction cannot run
   * until backup and visible-history retention provide real implementations.
   * Tests inject explicit evidence to exercise the lifecycle in isolation.
   */
  readonly pageCheckpointRetention?: PageCheckpointRetentionPolicy;
}

export interface BuiltApp {
  readonly app: FastifyInstance;
  readonly context: AppContext;
  readonly database: DatabaseHandle;
  /**
   * The administrator's key hierarchy, when the security layer is configured.
   *
   * Exposed so a rotation can be driven from a test without reaching into the
   * schema and reimplementing the unwrap. Nothing on the request path reads it
   * from here.
   */
  readonly keyHierarchy?: KeyHierarchy | undefined;
  /**
   * The services of one workspace (feature 058): checkpoint maintenance,
   * history consolidation, the operational envelope boundary, the archive.
   * Tests and tooling use it; requests reach them through their own scope.
   */
  forWorkspace(workspaceId: string): WorkspaceRuntime;
  /** Every registered route, for the isolation suite that must cover them all (058). */
  readonly routeTable: readonly { readonly method: string; readonly url: string }[];
  /** An `AppContext` bound to one workspace, for tests and tooling outside a request. */
  contextFor(workspaceId: string): AppContext;
  /** The one workspace of an app built without security (feature-001 harness), else null. */
  readonly unsecuredWorkspaceId: Uuid | null;
  close(): Promise<void>;
}

/**
 * The installation identity is fixed per deployment. It is a constant rather
 * than a generated value so a restart cannot mint a second installation.
 */
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
  await assertFullRestoreActivated(options.blobRoot);
  const database = createDatabase(options.databaseUrl);
  try {
    await assertStorageTransitionReady(database.db);
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

/**
 * Everything that is built for one workspace (feature 058, research D13).
 *
 * The services below were written for a single workspace and stay that way:
 * the API builds one set per account workspace, lazily, and routes reach the
 * set of the workspace bound to the current request.
 */
export interface WorkspaceRuntime {
  readonly workspaceId: Uuid;
  readonly keys?: KeyHierarchy;
  readonly protectedContent?: ProtectedContent;
  readonly protectedFiles?: ProtectedFileService;
  readonly search?: SearchService;
  readonly structuredQueries: DatabaseQueryService;
  readonly pageOperationCrypto?: PageOperationCrypto;
  readonly pageOperationArchive?: PageOperationArchiveService;
  readonly pageActivation?: PageActivationService;
  readonly pageHistory?: PageHistoryService;
  readonly pageOperations?: PageOperationService;
  readonly pageCheckpoints?: PageCheckpointService;
  readonly pageAmbiguities?: PageAmbiguityService;
  readonly legacyBranches?: LegacyBranchService;
  readonly mcpAccess?: McpAccessService;
  readonly recoveryKits?: RecoveryKitService;
  stop(): Promise<void>;
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is unavailable for this workspace`);
  return value;
}

async function composeApp(options: BuildAppOptions, database: DatabaseHandle): Promise<BuiltApp> {
  const schemaVersion = CANONICAL_SCHEMA_VERSION;
  const contentStore = new ContentStore(new FilesystemBlobStore(options.blobRoot));
  // Partial uploads live beside the blobs but not among them: they have no
  // digest until they are complete, and the content store is keyed by digest.
  const partialUploads = new PartialUploadStore(options.blobRoot);
  const now = options.now ?? (() => new Date());

  // Every lookup by identifier is confined to the workspace bound to the
  // current request (feature 058). Unbound code — CLI, a runtime's own
  // background work — is unaffected and already names its workspace.
  setWorkspaceFence(boundWorkspaceId);
  const runtimes = new Map<string, WorkspaceRuntime>();
  let buildRuntime: (workspaceId: Uuid) => WorkspaceRuntime = (workspaceId) => ({
    workspaceId,
    structuredQueries: createDatabaseQueryService({ db: database.db, workspaceId }),
    stop: async () => {},
  });
  const runtimeFor = (workspaceId: string): WorkspaceRuntime => {
    let runtime = runtimes.get(workspaceId);
    if (runtime === undefined) {
      runtime = buildRuntime(workspaceId as Uuid);
      runtimes.set(workspaceId, runtime);
    }
    return runtime;
  };
  /** The runtime of the bound workspace, or null outside any account. */
  const runtimeOrNull = (): WorkspaceRuntime | null => {
    const bound = boundWorkspaceId();
    if (bound !== null) return runtimeFor(bound);
    try {
      return runtimeFor(currentWorkspaceId());
    } catch (error) {
      if (error instanceof WorkspaceScopeError) return null;
      throw error;
    }
  };
  const currentRuntime = (): WorkspaceRuntime => runtimeFor(currentWorkspaceId());

  const context: AppContext = {
    db: database.db,
    get workspaceId() {
      // Throws outside an authenticated account: there is no default workspace.
      return currentWorkspaceId() as Uuid;
    },
    schemaVersion,
    contentStore,
    partialUploads,
    get protectedFiles() {
      return runtimeOrNull()?.protectedFiles;
    },
    get rotationPolicies() {
      return rotationPolicies;
    },
    get protectedContent() {
      return runtimeOrNull()?.protectedContent;
    },
    get devices() {
      return devices;
    },
    get search() {
      return runtimeOrNull()?.search;
    },
    get structuredQueries() {
      return runtimeOrNull()?.structuredQueries;
    },
    get pageOperationArchive() {
      return runtimeOrNull()?.pageOperationArchive;
    },
  };

  let rotationPolicies: RotationPolicyService | undefined;
  let devices: DeviceService | undefined;

  const app = Fastify({
    logger: options.logger === false ? false : registerLogging(),
    bodyLimit: 64 * 1024 * 1024,
  });
  const routeTable: { method: string; url: string }[] = [];
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat()) routeTable.push({ method, url: route.url });
  });
  // Every request runs in its own workspace scope, unbound until a principal
  // authenticates. `done` is called inside the scope so every later hook and
  // the handler inherit it.
  app.addHook("onRequest", (_request, _reply, done) => {
    enterRequestScope(() => done());
  });
  // Must precede every route so upgrade requests are intercepted by Fastify's
  // normal authentication hooks rather than falling through as plain HTTP.
  await app.register(websocket, {
    options: { maxPayload: MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES },
  });
  await app.register(multipart, {
    limits: { fileSize: maxFileBytes(), files: 1 },
  });
  // Every request gets a security context before any route runs, including
  // anonymous and rejected ones: the correlation ID it carries is the only
  // bridge between a redacted client problem and the unredacted server log,
  // and creating it lazily would leave exactly the failures an operator most
  // needs to trace without one.
  app.addHook("onRequest", (request, _reply, done) => {
    attachRequestContext(request, createRequestContext());
    done();
  });

  registerErrorHandling(app);
  // Before any route, so the version is on every response including the ones
  // that fail (T007, FR-017). A client that only ever sees errors still needs
  // to learn it is the one that is out of date.
  registerProtocolAnnouncement(app);
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

  let primaryKeys: KeyHierarchy | undefined;
  let unsecuredWorkspaceId: Uuid | null = null;
  const onCloseRuntimes = async () => {
    for (const runtime of runtimes.values()) await runtime.stop();
    runtimes.clear();
  };
  app.addHook("onClose", onCloseRuntimes);

  if (securityConfig === null) {
    // The feature-001 content harness: no principals, one workspace.
    const workspace = await getOrCreateWorkspace(database.db);
    unsecuredWorkspaceId = workspace.id;
    setUnsecuredFallbackWorkspace(workspace.id);
    app.addHook("onClose", async () => setUnsecuredFallbackWorkspace(null));
    const runtime = runtimeFor(workspace.id);
    void runtime.structuredQueries.rebuild().catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "structured database projection rebuild failed",
      );
    });
  } else {
    setUnsecuredFallbackWorkspace(null);
    // The installation row must exist before anything can create the
    // administrator against it. Idempotent: a restart, or two processes
    // starting at once, both find the existing row.
    await createInstallation(database.db, {
      id: INSTALLATION_ID,
      sourceLineageId: INSTALLATION_ID,
      schemaVersion,
    });
    registerInstallationRoutes(app, { db: database.db, config: securityConfig });
    const audit = new AuditService(database.db, { logger: app.log });

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

    rotationPolicies = new RotationPolicyService({
      db: database.db,
      installationId: INSTALLATION_ID,
      now,
    });
    const policies = rotationPolicies;

    const pageAdvances = new PageAdvanceNotifier();
    const pageSyncHub = new PageSyncHub();
    const pageSyncObservability = new RealtimePageSyncObservability(app.log);
    const unsubscribePageAdvances = pageAdvances.subscribe((event) => pageSyncHub.publish(event));
    app.addHook("onClose", async () => {
      unsubscribePageAdvances();
      pageSyncHub.close();
      pageAdvances.clear();
    });

    buildRuntime = (workspaceId) => {
      // The key hierarchy is deliberately *not* established here; account
      // creation does it in its transaction, and `dataKey` on the first
      // protected write covers a workspace that predates that.
      const protectedRuntime = createProtectedFileRuntime({
        db: database.db,
        journalDb: database.journalDb,
        installationId: INSTALLATION_ID,
        workspaceId,
        blobRoot: options.blobRoot,
        deploymentKey,
        now,
        reportIntegrityFailure: async (failure) => {
          await audit.record(
            {
              installationId: INSTALLATION_ID,
              workspaceId,
              // No request is in scope here — this is reached from inside a
              // repository read — so the event carries its own correlation id.
              correlationId: randomUUID(),
              actorClass: "system",
            },
            {
              eventType: "integrity.envelope-rejected",
              outcome: "failure",
              objectKind: failure.entityType,
              objectId: failure.entityId,
              metadata: {
                reason: failure.reason,
                keyGeneration: failure.keyGeneration,
                recordVersion: failure.recordVersion,
              },
            },
          );
        },
      });
      const protectedContent = protectedRuntime.content;
      const search = createDatabaseSearchService({
        db: database.db,
        workspaceId,
        protectedContent,
      });
      const structuredQueries = createDatabaseQueryService({
        db: database.db,
        workspaceId,
        protectedContent,
      });
      const pageOperationCrypto = new PageOperationCrypto(protectedRuntime.records);
      const pageOperationArchive = new PageOperationArchiveService({
        workspaceId,
        crypto: pageOperationCrypto,
      });
      const canonicalMaterializer = new CanonicalMaterializer(protectedContent);
      const pageActivation = new PageActivationService({
        db: database.db,
        workspaceId,
        crypto: pageOperationCrypto,
        protectedContent,
        rotationPolicies: policies,
        now,
      });
      let pageOperations: PageOperationService;
      const pageHistory = new PageHistoryService({
        db: database.db,
        workspaceId,
        protectedContent,
        rotationPolicies: policies,
        operations: () => pageOperations,
        search,
        now,
      });
      pageOperations = new PageOperationService({
        db: database.db,
        workspaceId,
        crypto: pageOperationCrypto,
        materializer: canonicalMaterializer,
        protectedContent,
        rotationPolicies: policies,
        history: pageHistory,
        search,
        onPageCommitted: (event) => pageAdvances.publish({ ...event, workspaceId }),
        now,
      });
      const pageCheckpoints = new PageCheckpointService({
        db: database.db,
        workspaceId,
        crypto: pageOperationCrypto,
        operations: pageOperations,
        rotationPolicies: policies,
        retention: options.pageCheckpointRetention ?? {
          checkpointIsInVerifiedBackup: async (tx, retentionContext) =>
            await pageOperationArchive.checkpointIsInVerifiedBackup(tx, retentionContext),
          historyAllowsCompaction: async (tx, retentionContext) =>
            await pageHistory.historyAllowsCompaction(tx, retentionContext),
        },
        now,
      });
      const pageAmbiguities = new PageAmbiguityService({
        db: database.db,
        workspaceId,
        crypto: pageOperationCrypto,
        operations: pageOperations,
        materializer: canonicalMaterializer,
        rotationPolicies: policies,
        onPageCommitted: (event) => pageAdvances.publish({ ...event, workspaceId }),
        now,
      });
      const legacyBranches = new LegacyBranchService({
        db: database.db,
        workspaceId,
        crypto: pageOperationCrypto,
        protectedContent,
        materializer: canonicalMaterializer,
        activation: pageActivation,
        operations: pageOperations,
        rotationPolicies: policies,
        search,
        onPageCommitted: (event) => pageAdvances.publish({ ...event, workspaceId }),
        now,
      });
      const mcpAccess = new McpAccessService({
        db: database.db,
        installationId: INSTALLATION_ID,
        workspaceId,
        records: protectedRuntime.records,
        audit,
        now,
        assertReady: async (executor) => {
          await protectedRuntime.keys.dataKey(executor, { writable: false });
        },
      });
      // Recovery-kit replacement for this workspace. The payload is the
      // workspace root key, sealed under the mounted deployment key.
      const recoveryKits = new RecoveryKitService({
        db: database.db,
        installationId: INSTALLATION_ID,
        sourceLineageId: INSTALLATION_ID,
        workspaceId,
        deploymentKey,
        supportedKeyGenerations: async () => {
          const current = await findCurrentGeneration(database.db, workspaceId);
          return current === null
            ? []
            : Array.from({ length: current.generation }, (_, index) => index + 1);
        },
        recoveryPayload: async () =>
          await protectedRuntime.keys.exportRecoveryMaterial(database.db),
        now,
      });

      // Background work of this workspace.
      void search.rebuild().catch((error: unknown) => {
        app.log.error(
          { errorName: error instanceof Error ? error.name : "unknown" },
          "workspace search rebuild failed",
        );
      });
      void structuredQueries.rebuild().catch((error: unknown) => {
        app.log.error(
          { errorName: error instanceof Error ? error.name : "unknown" },
          "structured database projection rebuild failed",
        );
      });
      const stopCleanup = startProtectedFileCleanup({
        db: database.db,
        files: protectedRuntime.files,
        now,
        reportFailure: (error) =>
          app.log.error(
            { errorName: error instanceof Error ? error.name : "unknown" },
            "protected file cleanup failed",
          ),
      });
      let consolidationRunning = false;
      const historyTimer = setInterval(() => {
        if (consolidationRunning) return;
        consolidationRunning = true;
        void pageHistory
          .consolidateDue()
          .then(({ failures }) => {
            for (const failure of failures) {
              app.log.error(
                { pageId: failure.pageId, failureCode: failure.code, errorName: failure.errorName },
                "page history consolidation failed",
              );
            }
          })
          .catch((error: unknown) => {
            app.log.error(
              {
                failureCode: "page-history.batch-failed",
                errorName: error instanceof Error ? error.name : "unknown",
              },
              "page history consolidation failed",
            );
          })
          .finally(() => {
            consolidationRunning = false;
          });
      }, 15_000);
      historyTimer.unref();

      return {
        workspaceId,
        keys: protectedRuntime.keys,
        protectedContent,
        protectedFiles: protectedRuntime.files,
        search,
        structuredQueries,
        pageOperationCrypto,
        pageOperationArchive,
        pageActivation,
        pageHistory,
        pageOperations,
        pageCheckpoints,
        pageAmbiguities,
        legacyBranches,
        mcpAccess,
        recoveryKits,
        stop: async () => {
          clearInterval(historyTimer);
          await stopCleanup();
          await recoveryKits.dispose();
        },
      };
    };

    // Existing accounts' workspaces start with the process, so their
    // background work (search, history consolidation, cleanup) runs even
    // before their owner's first request.
    for (const workspaceId of await listAccountWorkspaceIds(database.db)) runtimeFor(workspaceId);
    const administratorRecord = await findInstallation(database.db);
    if (administratorRecord?.administratorId != null) {
      const administrator = await findAccountById(database.db, administratorRecord.administratorId);
      if (administrator !== null) primaryKeys = runtimeFor(administrator.workspaceId).keys;
    }

    const ownerPrincipalResolver = createOwnerPrincipalResolver({
      sessions: sessionService,
      config: securityConfig,
    });
    const authenticateOwner = async (
      request: FastifyRequest,
    ): Promise<Extract<RequestPrincipal, { kind: "owner" }> | null> => {
      const outcome = await resolvePrincipal(request, [ownerPrincipalResolver]);
      if (
        !outcome.authenticated &&
        outcome.reason === "rejected" &&
        outcome.code === "device_revoked"
      )
        updateRequestContext(request, { authenticationRefusal: "device_revoked" });
      if (!outcome.authenticated || outcome.principal.kind !== "owner") return null;
      updateRequestContext(request, {
        principal: outcome.principal,
        workspaceId: outcome.principal.workspaceId,
      });
      // From here on, everything this request touches is this account's.
      bindWorkspace(outcome.principal.workspaceId);
      return outcome.principal;
    };

    // Bun's native WebSocket upgrade must be accepted before an asynchronous
    // database lookup yields. Ordinary HTTP requests still arrive at their
    // handlers fully resolved; the socket route pauses its connection, runs
    // this same resolver immediately after upgrade, then attaches the protocol
    // session before releasing any buffered frame.
    app.addHook("onRequest", (request, _reply, done) => {
      if (isWebSocketUpgradeRequest(request)) {
        done();
        return;
      }
      void authenticateOwner(request).then(() => done(), done);
    });

    const scopedSearch = scoped(() => required(currentRuntime().search, "search"));
    registerSearchRoutes(app, { service: scopedSearch });
    registerPlaceRoutes(app);

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
    /** Administration and installation-wide operations: members get a 404. */
    const requireAdministrator: typeof requireOwner = (request, reply, requirement) => {
      const owner = requireOwner(request, reply, requirement);
      if (owner === null) return null;
      if (owner.role !== "administrator") {
        sendSecurityProblem(reply, {
          code: "not_found",
          correlationId: requestContext(request).correlationId,
        });
        return null;
      }
      return owner;
    };

    // Route handlers receive resolved principals, but resolving a cookie alone
    // is not authorization. Protect all private HTTP routes before handlers.
    app.addHook("preHandler", (request, reply, done) => {
      const route = request.routeOptions.url ?? "";
      if (!isWebSocketUpgradeRequest(request) && requiresOwnerHttpAccess(route)) {
        const checkRouteReadinessBeforeCredentialProof = (): boolean => {
          const readiness = checkRouteReadiness(requestContext(request), route, request.method);
          if (readiness.ready) return true;
          sendSecurityProblem(reply, {
            code: readiness.code,
            correlationId: requestContext(request).correlationId,
          });
          return false;
        };

        // A valid owner session is already resolved by onRequest. Evaluate
        // readiness before CSRF so a missing deployment key is reported as the
        // installation failure it is, rather than as a misleading CSRF error.
        const ownerAlreadyResolved = requestContext(request).principal.kind === "owner";
        if (ownerAlreadyResolved && !checkRouteReadinessBeforeCredentialProof()) return;

        const owner = requireOwner(request, reply, {
          csrf: !["GET", "HEAD", "OPTIONS"].includes(request.method),
        });
        if (owner === null) return;
        if (!ownerAlreadyResolved && !checkRouteReadinessBeforeCredentialProof()) return;
      }
      done();
    });

    const accounts = new AccountService({
      db: database.db,
      installationId: INSTALLATION_ID,
      audit,
      sessions: sessionService,
      now,
      establishKeys: async (tx, workspaceId) => {
        await required(runtimeFor(workspaceId).keys, "keys").initialize(tx);
      },
      onAccountCreated: ({ workspaceId }) => {
        const runtime = runtimeFor(workspaceId);
        if (primaryKeys === undefined) primaryKeys = runtime.keys;
      },
      onAccountRevoked: ({ id, workspaceId }) => {
        pageSyncHub.closeOwner(id, 4401, "account-revoked");
        const runtime = runtimes.get(workspaceId);
        runtimes.delete(workspaceId);
        void runtime?.stop();
      },
    });
    registerAccountRoutes(app, {
      db: database.db,
      config: securityConfig,
      accounts,
      require: requireOwner,
      deploymentKey,
      publicOrigin: securityConfig.publicOrigin.origin,
      now,
    });

    registerBackupRoutes(app, {
      db: database.db,
      get workspaceId() {
        return currentWorkspaceId() as Uuid;
      },
      now,
      require: requireAdministrator,
      fullBackupService: new FullBackupService({
        connectionString: options.databaseUrl,
        blobRoot: options.blobRoot,
        backupRoot: options.fullBackupRoot ?? fullBackupRoot(loadBackupConfig()),
        historicalKeyFiles: loadBackupConfig().historicalKeyFiles,
        key: () => {
          const key = deploymentKey();
          if (key === null) throw new Error("The deployment key is unavailable.");
          return key;
        },
        now,
      }),
      runRehearsal: async () => {
        const destination = createBackupDestination(loadBackupConfig());
        return await restoreTestCommand(
          {
            db: database.db,
            workspaceId: currentWorkspaceId() as Uuid,
            destination,
            open: async (ciphertext) => {
              const key = deploymentKey();
              if (key === null) {
                throw new Error("the mounted deployment key is unavailable");
              }
              return openBackupArchive(key, ciphertext);
            },
            installation: {
              schemaVersion,
              recordFormatVersion: BACKUP_RECORD_FORMAT_VERSION,
            },
            databaseUrl: options.databaseUrl,
          },
          { latest: true },
        );
      },
    });

    // Rotation: status is readable by the administrator, starting one needs a
    // fresh proof. The scheduler evaluates at startup so an overdue key is
    // reported by a restart rather than only by a timer the process may never
    // reach.
    registerRotationRoutes(app, {
      db: database.db,
      policies,
      audit,
      installationId: INSTALLATION_ID,
      now,
      require: requireAdministrator,
    });
    registerSecurityAuditRoutes(app, {
      db: database.db,
      installationId: INSTALLATION_ID,
      require: requireOwner,
    });
    const rotationScheduler = new RotationScheduler({
      policies,
      logger: app.log,
      // Audited from the evaluation rather than from the write path: one row
      // per refused write would bury the event under thousands of copies of
      // itself, exactly when an operator most needs to find it.
      onWriteBlocked: async (blocked) => {
        await audit.record(
          {
            installationId: INSTALLATION_ID,
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
    });
    // Startup is a lifecycle boundary, not fire-and-forget work. Returning the
    // app while this database read is still in flight lets an immediate close
    // end the pool underneath it.
    app.addHook("onClose", async () => {
      rotationScheduler.stop();
    });
    await rotationScheduler.start();

    // The installation's recovery kit is the administrator's (research D12).
    registerRecoveryRoutes(app, {
      kits: scoped(() => required(currentRuntime().recoveryKits, "recovery kits")),
      audit,
      installationId: INSTALLATION_ID,
      require: requireAdministrator,
    });

    devices = new DeviceService({ db: database.db, now });
    registerDeviceRoutes(app, {
      devices,
      audit,
      installationId: INSTALLATION_ID,
      require: requireOwner,
      onDeviceRevoked: ({ ownerId, deviceId }) => {
        pageSyncHub.closeDevice(ownerId, deviceId, 4403, "device-revoked");
      },
    });

    const scopedActivation = scoped(() => required(currentRuntime().pageActivation, "activation"));
    const scopedOperations = scoped(() =>
      required(currentRuntime().pageOperations, "page operations"),
    );
    const scopedLegacy = scoped(() => required(currentRuntime().legacyBranches, "legacy branches"));
    const scopedMcpAccess = scoped(() => required(currentRuntime().mcpAccess, "MCP access"));
    registerMcpManagementRoutes(app, {
      access: scopedMcpAccess,
      require: requireOwner,
      publicOrigin: securityConfig.publicOrigin.origin,
      db: database.db,
      installationId: INSTALLATION_ID,
      now,
      bindExchangeWorkspace: async (code) => {
        const workspaceId = await findMcpWorkspace(database.db, { kind: "exchange", secret: code });
        if (workspaceId === null) {
          await recordUnknownMcpCredential(audit, {
            installationId: INSTALLATION_ID,
            kind: "exchange",
            correlationId: randomUUID(),
          });
          return false;
        }
        bindWorkspace(workspaceId);
        return true;
      },
    });
    registerMcpHttp(app, {
      context,
      access: scopedMcpAccess,
      operations: scopedOperations,
      activation: scopedActivation,
      onPageCommitted: (event) =>
        pageAdvances.publish({ ...event, workspaceId: currentWorkspaceId() }),
      publicOrigin: securityConfig.publicOrigin.origin,
      // The bearer names its connection, the connection names its workspace:
      // bind the request to it before any MCP service is reached.
      installationId: INSTALLATION_ID,
      now,
      bindBearerWorkspace: async (bearer) => {
        const workspaceId = await findMcpWorkspace(database.db, { kind: "bearer", secret: bearer });
        if (workspaceId === null) {
          await recordUnknownMcpCredential(audit, {
            installationId: INSTALLATION_ID,
            kind: "bearer",
            correlationId: randomUUID(),
          });
          return false;
        }
        bindWorkspace(workspaceId);
        return true;
      },
    });

    registerPageOperationRoutes(app, {
      db: database.db,
      require: requireOwner,
      activation: scopedActivation,
      operations: scopedOperations,
      ambiguities: scoped(() => required(currentRuntime().pageAmbiguities, "ambiguities")),
      legacy: scopedLegacy,
    });
    registerPageSyncSocketRoutes(app, {
      db: database.db,
      config: securityConfig,
      deploymentKey,
      authenticate: authenticateOwner,
      activation: scopedActivation,
      operations: scopedOperations,
      legacy: scopedLegacy,
      hub: pageSyncHub,
      observability: pageSyncObservability,
    });
  }

  const pageHistory = scoped(() => required(currentRuntime().pageHistory, "page history"));
  registerItemRoutes(app, context);
  registerDatabaseRoutes(app, context);
  registerPlacementRoutes(app, context);
  registerPageDocumentRoutes(app, context);
  registerFileRoutes(app, context);
  registerUploadRoutes(app, context);
  registerRelationshipRoutes(app, context);
  registerRevisionRoutes(app, context, {
    history: securityConfig === null ? undefined : pageHistory,
    now: options.now,
  });
  registerChangeRoutes(app, context);
  registerChangeStreamRoutes(app, context);
  registerSnapshotRoutes(app, context);
  registerMutationBatchRoutes(app, context);
  registerExportRoutes(app, context);

  /** Test and tooling access to one workspace's services. */
  const forWorkspace = (workspaceId: string) => runtimeFor(workspaceId);
  const contextFor = (workspaceId: string): AppContext => ({
    db: database.db,
    workspaceId: workspaceId as Uuid,
    schemaVersion,
    contentStore,
    partialUploads,
    get protectedFiles() {
      return runtimeFor(workspaceId).protectedFiles;
    },
    get rotationPolicies() {
      return rotationPolicies;
    },
    get protectedContent() {
      return runtimeFor(workspaceId).protectedContent;
    },
    get devices() {
      return devices;
    },
    get search() {
      return runtimeFor(workspaceId).search;
    },
    get structuredQueries() {
      return runtimeFor(workspaceId).structuredQueries;
    },
    get pageOperationArchive() {
      return runtimeFor(workspaceId).pageOperationArchive;
    },
  });

  return {
    app,
    context,
    database,
    forWorkspace,
    contextFor,
    routeTable,
    unsecuredWorkspaceId,
    get keyHierarchy() {
      return primaryKeys;
    },
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}
