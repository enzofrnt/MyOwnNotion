import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSRF_TOKEN_HEADER } from "@myownnotion/contracts";
import { type DisposablePostgres, startDisposablePostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCommand } from "../src/admin/command-parser.ts";
import { runFullBackupCommand } from "../src/admin/full-backup-commands.ts";
import { buildApp } from "../src/app.ts";
import { FullBackupActivities } from "../src/backup/full/activity.ts";
import { PostgresFullBackupTools } from "../src/backup/full/postgres.ts";
import { rehearseFullBackup } from "../src/backup/full/rehearsal.ts";
import { activateFullRestore, restoreFullBackup } from "../src/backup/full/restore.ts";
import {
  assertFullRestoreActivated,
  readFullRestoreState,
} from "../src/backup/full/restore-state.ts";
import { FullBackupService } from "../src/backup/full/service.ts";
import { hashPassword } from "../src/security/password-service.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  currentProtocolHeaders,
} from "./helpers/app.ts";
import { authenticatedContent } from "./helpers/content-owner.ts";

let harness: ApiHarness;
let directory: string;
let archivePath: string;
let oldHeaders: Record<string, string>;
let pageId: string;
let protectedFileId: string;
const password = "correct horse battery staple";
const protectedBytes = Buffer.from("Authenticated attachment after complete recovery");
const key = randomBytes(32);
const attachment = Buffer.from("Private full recovery attachment\n");
const attachmentId = createHash("sha256").update(attachment).digest("hex");
const targets: DisposablePostgres[] = [];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "mon-full-restore-test-"));
  const keyFile = join(directory, "external-key");
  await writeFile(keyFile, key.toString("base64"), { mode: 0o600 });
  harness = await createApiHarness({
    fullBackupRoot: join(directory, "backups"),
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
    }),
  });
  const authenticated = await authenticatedContent(harness);
  oldHeaders = authenticated.headers;
  const credential = await hashPassword(password);
  await harness.built.database.db.execute(sql`
    INSERT INTO password_credential_versions(id, owner_id, password_hash, hash_algorithm, state)
    SELECT gen_random_uuid(), id, ${credential.encoded}, 'scrypt', 'active' FROM owners
  `);
  const upload = await authenticated({
    method: "POST",
    url: "/v1/uploads",
    headers: {
      "upload-length": String(protectedBytes.length),
      "upload-metadata": `filename ${Buffer.from("private-restored.txt").toString("base64")},mediaType ${Buffer.from("text/plain").toString("base64")}`,
    },
  });
  expect(upload.statusCode, upload.body).toBe(201);
  const completed = await authenticated({
    method: "PATCH",
    url: String(upload.headers.location),
    headers: { "content-type": "application/offset+octet-stream", "upload-offset": "0" },
    payload: protectedBytes,
  });
  expect(completed.statusCode, completed.body).toBe(201);
  protectedFileId = completed.json().itemId as string;

  pageId = (
    await createItemViaApi(harness, {
      kind: "page",
      name: "Private complete recovery page",
      headers: oldHeaders,
    })
  ).itemId;
  await harness.built.database.db.execute(
    sql`CREATE TABLE full_backup_unknown_fixture (id integer PRIMARY KEY, contents text)`,
  );
  await harness.built.database.db.execute(
    sql`INSERT INTO full_backup_unknown_fixture VALUES (1, 'opaque historical data')`,
  );
  await harness.built.database.db.execute(sql`
    INSERT INTO bootstrap_attempts(id, installation_id, capability_hash, client_nonce_hash, challenge_hash, download_token_hash, download_expires_at)
    SELECT gen_random_uuid(), id, repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64), now() + interval '1 hour' FROM installations
  `);
  await harness.built.database.db.execute(sql`
    INSERT INTO recovery_kits(id, installation_id, source_lineage_id, recovery_epoch, authorization_state, delivery_state, supported_key_generations, artifact_digest, download_token_hash, download_expires_at)
    SELECT gen_random_uuid(), id, source_lineage_id, 1, 'provisional', 'downloadable', ARRAY[1], repeat('e', 64), repeat('f', 64), now() + interval '1 hour' FROM installations
  `);
  const backup = new FullBackupService({
    connectionString: harness.postgres.connectionString,
    blobRoot: harness.blobRoot,
    backupRoot: join(directory, "backups"),
    key: () => key,
  });
  await mkdir(join(harness.blobRoot, attachmentId.slice(0, 2)), { recursive: true });
  await writeFile(join(harness.blobRoot, attachmentId.slice(0, 2), attachmentId), attachment);
  archivePath = (await backup.run("manual")).path;
});
afterAll(async () => {
  await harness?.close();
  await Promise.all(targets.map((target) => target.stop()));
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});
async function target() {
  const database = await startDisposablePostgres();
  targets.push(database);
  return {
    archivePath,
    workingDirectory: directory,
    targetDirectory: join(directory, `restored-${randomUUID()}`),
    targetConnectionString: database.connectionString,
    activeConnectionString: harness.postgres.connectionString,
    activeDirectory: harness.blobRoot,
    key,
  };
}

describe("full restore and explicit security activation", () => {
  it("restores the actual schema and private envelopes, blocks startup, then invalidates sessions without replacing device identities", async () => {
    const input = await target();
    const result = await restoreFullBackup(input);
    expect(result.activationRequired).toBe(true);
    expect(
      await readFile(join(input.targetDirectory, attachmentId.slice(0, 2), attachmentId)),
    ).toEqual(attachment);
    await expect(
      buildApp({
        databaseUrl: input.targetConnectionString,
        blobRoot: input.targetDirectory,
        logger: false,
      }),
    ).rejects.toThrow("activation");
    const client = new pg.Client({ connectionString: input.targetConnectionString });
    await client.connect();
    try {
      expect((await client.query("SELECT * FROM full_backup_unknown_fixture")).rows).toEqual([
        { id: 1, contents: "opaque historical data" },
      ]);
      const before = (
        await client.query("SELECT id, device_binding_id, state FROM authorized_devices")
      ).rows;
      expect(before).toHaveLength(1);
      expect(before[0].state).toBe("active");
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM protected_envelopes")).rows[0]
          .count,
      ).toBeGreaterThan(0);
      const activated = await activateFullRestore(input);
      expect(activated).toMatchObject({ sessionsInvalidated: 1, devicesRequireAuthentication: 1 });
      expect(
        (
          await client.query(
            "SELECT bootstrap_state, capability_hash <> repeat('a', 64) AS invalidated, challenge_hash FROM bootstrap_attempts",
          )
        ).rows,
      ).toEqual([{ bootstrap_state: "abandoned", invalidated: true, challenge_hash: null }]);
      expect(
        (
          await client.query(
            "SELECT authorization_state, delivery_state, download_token_hash FROM recovery_kits",
          )
        ).rows,
      ).toEqual([
        { authorization_state: "rejected", delivery_state: "expired", download_token_hash: null },
      ]);
      expect(
        (await client.query("SELECT id, device_binding_id, state FROM authorized_devices")).rows,
      ).toEqual([{ ...before[0], state: "reauthorization-required" }]);
      expect(
        (await client.query("SELECT state, revoked_at IS NOT NULL AS revoked FROM sessions")).rows,
      ).toEqual([{ state: "revoked", revoked: true }]);
      await expect(assertFullRestoreActivated(input.targetDirectory)).resolves.toBeUndefined();
      const built = await buildApp({
        databaseUrl: input.targetConnectionString,
        blobRoot: input.targetDirectory,
        logger: false,
        security: loadSecurityConfig({
          MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
          MYOWNNOTION_API_HOST: "127.0.0.1",
          MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
          MYOWNNOTION_DEPLOYMENT_KEY_FILE: join(directory, "external-key"),
        }),
      });
      try {
        expect(
          (
            await built.app.inject({
              method: "GET",
              url: `/v1/items/${pageId}`,
              headers: oldHeaders,
            })
          ).statusCode,
        ).toBe(401);
        expect(await built.context.protectedContent?.readItemName(built.database.db, pageId)).toBe(
          "Private complete recovery page",
        );
        expect(
          (
            await built.app.inject({
              method: "GET",
              url: `/v1/files/${protectedFileId}/content`,
              headers: oldHeaders,
            })
          ).statusCode,
        ).toBe(401);
        const login = await built.app.inject({
          method: "POST",
          url: "/v1/auth/login/password",
          headers: currentProtocolHeaders(),
          payload: {
            password,
            device: {
              deviceBindingId: `web-${randomUUID()}`,
              name: "Freshly authorized recovery device",
              platform: "Test platform",
            },
          },
        });
        expect(login.statusCode, login.body).toBe(200);
        const setCookie = login.headers["set-cookie"];
        const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";")[0];
        if (cookie === undefined) throw new Error("Recovery login returned no cookie");
        const recovered = await built.app.inject({
          method: "GET",
          url: `/v1/files/${protectedFileId}/content`,
          headers: { cookie },
        });
        expect(recovered.statusCode, recovered.body).toBe(200);
        expect(recovered.rawPayload).toEqual(protectedBytes);
        const range = await built.app.inject({
          method: "GET",
          url: `/v1/files/${protectedFileId}/content`,
          headers: { cookie, range: "bytes=2-12" },
        });
        expect(range.statusCode, range.body).toBe(206);
        expect(range.rawPayload).toEqual(protectedBytes.subarray(2, 13));
        expect(
          (
            await client.query(
              "SELECT count(*)::integer AS count FROM authorized_devices WHERE state = 'active'",
            )
          ).rows[0].count,
        ).toBe(1);
      } finally {
        await built.close();
      }
    } finally {
      await client.end();
    }
  });

  it("restores and activates a V0 database that predates the application authentication tables", async () => {
    const source = await startDisposablePostgres();
    targets.push(source);
    const sourceFiles = join(directory, `v0-files-${randomUUID()}`);
    const client = new pg.Client({ connectionString: source.connectionString });
    await client.connect();
    try {
      await client.query(
        "CREATE TABLE historical_records(id serial PRIMARY KEY, contents bytea NOT NULL); INSERT INTO historical_records(contents) VALUES (decode('00ff','hex'))",
      );
    } finally {
      await client.end();
    }
    const backup = await new FullBackupService({
      connectionString: source.connectionString,
      blobRoot: sourceFiles,
      backupRoot: join(directory, `v0-backups-${randomUUID()}`),
      key: () => key,
    }).run("pre-update");
    expect(backup.manifest.source).toMatchObject({
      installationId: null,
      applicationVersion: null,
      appliedMigrations: [],
    });
    const destination = await target();
    await restoreFullBackup({
      ...destination,
      archivePath: backup.path,
      activeConnectionString: source.connectionString,
      activeDirectory: sourceFiles,
    });
    expect(await activateFullRestore(destination)).toMatchObject({
      sessionsInvalidated: 0,
      devicesRequireAuthentication: 0,
    });
    const restored = new pg.Client({ connectionString: destination.targetConnectionString });
    await restored.connect();
    try {
      expect(
        (
          await restored.query(
            "SELECT id, encode(contents, 'hex') AS contents FROM historical_records",
          )
        ).rows,
      ).toEqual([{ id: 1, contents: "00ff" }]);
    } finally {
      await restored.end();
    }
  });

  it("refuses a restore path whose parent is a file before changing its empty database", async () => {
    const input = await target();
    const parent = join(directory, `parent-file-${randomUUID()}`);
    await writeFile(parent, "operator file");
    await expect(
      restoreFullBackup({ ...input, targetDirectory: join(parent, "restored") }),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
    expect(await readFile(parent, "utf8")).toBe("operator file");
    const check = new pg.Client({ connectionString: input.targetConnectionString });
    try {
      await check.connect();
      expect(
        (await check.query("SELECT to_regclass('public.items') AS items")).rows[0].items,
      ).toBeNull();
    } finally {
      await check.end();
    }
  });

  it("authenticates corruption before creating any target files or database tables", async () => {
    const input = await target();
    const corruptPath = join(directory, `damaged-${randomUUID()}`);
    const bytes = await readFile(archivePath);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    await writeFile(corruptPath, bytes);
    await expect(restoreFullBackup({ ...input, archivePath: corruptPath })).rejects.toThrow();
    // Authentication precedes even connecting to a database for a rehearsal.
    await expect(
      rehearseFullBackup({
        archivePath: corruptPath,
        connectionString: "postgres://fixture:fixture@127.0.0.1:1/unreachable",
        activeDirectory: harness.blobRoot,
        key,
      }),
    ).rejects.toThrow();

    await expect(readdir(input.targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    const client = new pg.Client({ connectionString: input.targetConnectionString });
    await client.connect();
    try {
      expect(
        (await client.query("SELECT to_regclass('public.items') AS relation")).rows[0].relation,
      ).toBeNull();
    } finally {
      await client.end();
    }
  });

  it("previews a complete restore without creating the target directory and refuses a nonempty or active target", async () => {
    const input = await target();
    expect((await restoreFullBackup({ ...input, dryRun: true })).dryRun).toBe(true);
    const activeChild = join(harness.blobRoot, "must-not-restore");
    await expect(restoreFullBackup({ ...input, targetDirectory: activeChild })).rejects.toThrow(
      "separate",
    );
    await expect(readdir(activeChild)).rejects.toMatchObject({ code: "ENOENT" });
    const alias = join(directory, "source-alias");
    await symlink(harness.blobRoot, alias, "dir");
    await expect(
      restoreFullBackup({ ...input, targetDirectory: join(alias, "new-target") }),
    ).rejects.toThrow("separate");

    await expect(readdir(input.targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      restoreFullBackup({ ...input, targetConnectionString: input.activeConnectionString }),
    ).rejects.toThrow("active");
    await restoreFullBackup(input);
    await expect(
      restoreFullBackup({ ...input, targetDirectory: join(directory, "another-empty-directory") }),
    ).rejects.toThrow("not empty");
  });

  it("refuses an active database reached through a hostname alias", async () => {
    const input = await target();
    const alias = new URL(input.activeConnectionString);
    alias.hostname = alias.hostname === "localhost" ? "127.0.0.1" : "localhost";
    await expect(
      restoreFullBackup({
        ...input,
        targetConnectionString: input.activeConnectionString,
        activeConnectionString: alias.href,
      }),
    ).rejects.toThrow("active application database");
    await expect(readdir(input.targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows explicit isolated recovery when the original host is unreachable", async () => {
    const input = await target();
    const lostHost = new URL(input.targetConnectionString);
    lostHost.port = "1";
    expect(
      await restoreFullBackup({ ...input, activeConnectionString: lostHost.href, dryRun: true }),
    ).toMatchObject({ dryRun: true });
    await expect(readdir(input.targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses files, symlinks and nonempty directories without touching their contents", async () => {
    const input = await target();
    await writeFile(input.targetDirectory, "must survive");
    await expect(restoreFullBackup(input)).rejects.toThrow("real directory");
    expect(await readFile(input.targetDirectory, "utf8")).toBe("must survive");
    await rm(input.targetDirectory);
    await mkdir(input.targetDirectory);
    await writeFile(join(input.targetDirectory, "existing"), "must survive");
    await expect(restoreFullBackup(input)).rejects.toThrow("directory is not empty");
    expect(await readFile(join(input.targetDirectory, "existing"), "utf8")).toBe("must survive");
    const alias = `${input.targetDirectory}-alias`;
    await symlink(input.targetDirectory, alias, "dir");
    await expect(restoreFullBackup({ ...input, targetDirectory: alias })).rejects.toThrow(
      "real directory",
    );
  });

  it("binds activation to its restored database and keeps the barrier after a transactional failure", async () => {
    const input = await target();
    await restoreFullBackup(input);
    const other = await target();
    await expect(
      activateFullRestore({ ...input, targetConnectionString: other.targetConnectionString }),
    ).rejects.toThrow("different target database");
    const client = new pg.Client({ connectionString: input.targetConnectionString });
    await client.connect();
    try {
      await client.query(`CREATE FUNCTION refuse_device_activation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'activation failure fixture'; END $$;
        CREATE TRIGGER refuse_device_activation BEFORE UPDATE ON authorized_devices FOR EACH ROW EXECUTE FUNCTION refuse_device_activation()`);
      await expect(activateFullRestore(input)).rejects.toThrow("activation failure fixture");
      expect((await client.query("SELECT state FROM sessions")).rows).toEqual([
        { state: "active" },
      ]);
      expect((await readFullRestoreState(input.targetDirectory, key)).stage).toBe("data-restored");
      await expect(assertFullRestoreActivated(input.targetDirectory)).rejects.toThrow(
        "cannot start",
      );
      await client.query("DROP TRIGGER refuse_device_activation ON authorized_devices");
      await expect(activateFullRestore(input)).resolves.toMatchObject({ sessionsInvalidated: 1 });
    } finally {
      await client.end();
    }
  });

  it("refuses provenance drift after the native restore and leaves activation blocked", async () => {
    const input = await target();
    class DriftedRestore extends PostgresFullBackupTools {
      override async restore(connection: string, source: AsyncIterable<Uint8Array>) {
        await super.restore(connection, source);
        const client = new pg.Client({ connectionString: connection });
        await client.connect();
        try {
          await client.query(
            "DELETE FROM schema_migrations WHERE version = '0014_full_backup_provenance'",
          );
        } finally {
          await client.end();
        }
      }
    }
    await expect(restoreFullBackup({ ...input, tools: new DriftedRestore() })).rejects.toThrow(
      "provenance does not match",
    );
    expect((await readFullRestoreState(input.targetDirectory, key)).stage).toBe("incomplete");
    await expect(activateFullRestore(input)).rejects.toThrow("incomplete");
  });

  it("keeps an incomplete marker after restore failure and refuses activation of that target", async () => {
    const input = await target();
    class FailingRestore extends PostgresFullBackupTools {
      override async restore() {
        throw new Error("restore interrupted fixture");
      }
    }
    await expect(restoreFullBackup({ ...input, tools: new FailingRestore() })).rejects.toThrow(
      "restore interrupted",
    );
    expect((await readFullRestoreState(input.targetDirectory, key)).stage).toBe("incomplete");
    await expect(activateFullRestore(input)).rejects.toThrow("incomplete");
    await expect(assertFullRestoreActivated(input.targetDirectory)).rejects.toThrow("cannot start");
  });
});

it("inspects without live access, refuses unauthorized apply and rehearses actual recovery through the full CLI", async () => {
  const env = {
    DATABASE_URL: harness.postgres.connectionString,
    MYOWNNOTION_BLOB_ROOT: harness.blobRoot,
    MYOWNNOTION_BACKUP_ROOT: join(directory, "cli-backups"),
    MYOWNNOTION_DEPLOYMENT_KEY_FILE: join(directory, "external-key"),
  };
  const inspected = await runFullBackupCommand(
    parseCommand(["backup", "full", "inspect", "--file", archivePath]),
    {
      ...env,
      DATABASE_URL: "postgres://unavailable:private@127.0.0.1:1/missing",
    },
  );
  expect(inspected.code).toBe(0);
  expect(inspected.data?.["componentCount"]).toBeGreaterThan(0);
  const refused = await runFullBackupCommand(
    parseCommand([
      "restore",
      "full",
      "apply",
      "--file",
      archivePath,
      "--target-directory",
      join(directory, "must-not-create"),
    ]),
    env,
  );
  expect(refused.code).toBe(3);
  await expect(readdir(join(directory, "must-not-create"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const rehearsed = await runFullBackupCommand(
    parseCommand(["restore", "full", "test", "--file", archivePath]),
    env,
  );
  expect(rehearsed).toMatchObject({ code: 0, data: { databaseRestored: true } });
  expect(
    await new FullBackupActivities(join(env.MYOWNNOTION_BACKUP_ROOT, "full"), () => key).read(
      "rehearsal",
    ),
  ).toMatchObject({ outcome: "succeeded", backupId: rehearsed.data?.["backupId"] });
  const live = await harness.built.database.db.execute(
    sql`SELECT contents FROM full_backup_unknown_fixture`,
  );
  expect(live.rows).toEqual([{ contents: "opaque historical data" }]);
  const corruptPath = join(directory, "cli-corrupt");
  await writeFile(corruptPath, "private broken data");
  const failed = await runFullBackupCommand(
    parseCommand(["backup", "full", "verify", "--file", corruptPath]),
    env,
  );
  expect(failed.code).toBe(5);
  expect(JSON.stringify(failed)).not.toContain("private broken data");

  const activeTargetRefusal = await runFullBackupCommand(
    parseCommand([
      "restore",
      "full",
      "apply",
      "--file",
      archivePath,
      "--target-directory",
      join(directory, "active-target-refusal"),
      "--yes",
    ]),
    { ...env, MYOWNNOTION_RESTORE_DATABASE_URL: env.DATABASE_URL },
  );
  expect(activeTargetRefusal.code).toBe(3);
  await expect(readdir(join(directory, "active-target-refusal"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const badCommand = parseCommand(["backup", "full", "unknown"]);
  await expect(runFullBackupCommand(badCommand, env)).rejects.toThrow(
    "Unknown complete-backup command",
  );
  const lostRemote = await runFullBackupCommand(parseCommand(["backup", "full", "run"]), {
    ...env,
    MYOWNNOTION_BACKUP_DESTINATION: "google-drive",
    MYOWNNOTION_BACKUP_GOOGLE_DRIVE_FOLDER_ID: "fixture-folder",
    MYOWNNOTION_BACKUP_GOOGLE_DRIVE_TOKEN_FILE: join(directory, "missing-remote-token"),
  });
  expect(lostRemote).toMatchObject({ code: 0, data: { remote: "failed" } });
  // This local safety archive is real and remains inspectable despite losing
  // the configured provider credential; no remote request can authenticate.
  expect(await readdir(join(env.MYOWNNOTION_BACKUP_ROOT, "full"))).toContain(
    `${lostRemote.data?.["backupId"]}.monfull`,
  );
  await rm(join(env.MYOWNNOTION_BACKUP_ROOT, "full"), { recursive: true });
  const created = await runFullBackupCommand(parseCommand(["backup", "full", "run"]), env);
  expect(created).toMatchObject({ code: 0, data: { remote: "not-configured" } });
  const listed = await runFullBackupCommand(parseCommand(["backup", "full", "list"]), env);
  expect(listed.data?.["backups"]).toEqual([
    expect.objectContaining({ backupId: created.data?.["backupId"] }),
  ]);
  const root = join(env.MYOWNNOTION_BACKUP_ROOT, "full");
  await writeFile(join(root, "uncatalogued.monfull"), "partial unknown artifact");
  await writeFile(join(root, "invalid.receipt"), "invalid receipt");
  const inventory = await runFullBackupCommand(parseCommand(["backup", "full", "list"]), env);
  expect(inventory.data).toMatchObject({
    invalidReceipts: 1,
    uncataloguedArtifacts: ["uncatalogued.monfull"],
  });
  expect(
    await runFullBackupCommand(parseCommand(["backup", "full", "run"]), {
      ...env,
      MYOWNNOTION_BACKUP_DESTINATION: "google-drive",
    }),
  ).toMatchObject({ code: 0, data: { remote: "failed" } });

  const restore = await target();
  const restoreEnv = { ...env, MYOWNNOTION_RESTORE_DATABASE_URL: restore.targetConnectionString };
  const apply = [
    "restore",
    "full",
    "apply",
    "--file",
    archivePath,
    "--target-directory",
    restore.targetDirectory,
  ];
  expect(
    await runFullBackupCommand(parseCommand([...apply, "--dry-run"]), restoreEnv),
  ).toMatchObject({ code: 0, data: { dryRun: true } });
  expect(await runFullBackupCommand(parseCommand([...apply, "--yes"]), restoreEnv)).toMatchObject({
    code: 0,
    data: { activationRequired: true },
  });
  const activate = ["restore", "full", "activate", "--target-directory", restore.targetDirectory];
  expect(await runFullBackupCommand(parseCommand(activate), restoreEnv)).toMatchObject({ code: 3 });
  expect(
    await runFullBackupCommand(parseCommand([...activate, "--yes"]), restoreEnv),
  ).toMatchObject({ code: 0, data: { sessionsInvalidated: 1 } });
  await expect(assertFullRestoreActivated(restore.targetDirectory)).resolves.toBeUndefined();
  await expect(runFullBackupCommand(parseCommand([...apply, "--yes"]), env)).rejects.toThrow(
    "MYOWNNOTION_RESTORE_DATABASE_URL",
  );
  await expect(
    runFullBackupCommand(parseCommand(["backup", "full", "run", "--yes"]), env),
  ).rejects.toThrow("not supported");
});

it("exposes full protection and a real persisted rehearsal only to the authenticated owner", async () => {
  const app = harness.built.app;
  const route = "/v1/backups/full/status";
  expect((await app.inject({ method: "GET", url: route })).statusCode).toBe(401);
  const status = await app.inject({ method: "GET", url: route, headers: oldHeaders });
  expect(status.statusCode).toBe(200);
  expect(status.json()).toMatchObject({
    stale: false,
    latestAttemptOutcome: "succeeded",
    remote: "not-configured",
  });
  expect(status.body).not.toContain(directory);
  const noCsrf = { ...oldHeaders };
  delete noCsrf[CSRF_TOKEN_HEADER];
  expect(
    (await app.inject({ method: "POST", url: "/v1/backups/full/rehearsals", headers: noCsrf }))
      .statusCode,
  ).toBe(403);
  const rehearsed = await app.inject({
    method: "POST",
    url: "/v1/backups/full/rehearsals",
    headers: oldHeaders,
  });
  expect(rehearsed.statusCode).toBe(200);
  expect(rehearsed.json()).toMatchObject({ databaseRestored: true });
  const after = await app.inject({ method: "GET", url: route, headers: oldHeaders });
  expect(after.json()).toMatchObject({ lastRehearsalOutcome: "succeeded", rehearsalDue: false });
});
