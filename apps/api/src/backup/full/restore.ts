/** Restore into an explicit empty database and directory, after complete authentication. */
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { VerifiedFullArchive } from "./archive.ts";
import { FullRestoreRefusal } from "./errors.ts";
import { acquireFullBackupLocks } from "./locks.ts";
import { PostgresFullBackupTools, postgresToolEnvironment } from "./postgres.ts";
import {
  FULL_RESTORE_MARKER,
  type FullRestoreState,
  readFullRestoreState,
  writeFullRestoreState,
} from "./restore-state.ts";
import { inspectFullSource } from "./source.ts";

async function targetIdentity(
  client: pg.Client,
): Promise<Pick<FullRestoreState, "databaseName" | "databaseOid" | "clusterId">> {
  const result = await client.query<{
    database_name: string;
    database_oid: number;
    cluster_id: string;
  }>(`
    SELECT current_database() AS database_name,
      (SELECT oid FROM pg_database WHERE datname = current_database()) AS database_oid,
      (SELECT system_identifier::text FROM pg_control_system()) AS cluster_id
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("The restore target identity could not be inspected.");
  return {
    databaseName: row.database_name,
    databaseOid: row.database_oid,
    clusterId: row.cluster_id,
  };
}

async function refuseActiveTarget(
  target: pg.Client,
  activeConnectionString: string,
  targetConnectionString: string,
): Promise<void> {
  const active = postgresToolEnvironment(activeConnectionString);
  const requested = postgresToolEnvironment(targetConnectionString);
  if (active["PGDATABASE"] !== requested["PGDATABASE"]) return;
  if (active["PGHOST"] === requested["PGHOST"] && active["PGPORT"] === requested["PGPORT"]) {
    throw new FullRestoreRefusal("The active application database cannot be a restore target.");
  }
  const client = new pg.Client({
    connectionString: activeConnectionString,
    connectionTimeoutMillis: 5_000,
  });
  try {
    try {
      await client.connect();
    } catch {
      // Complete disaster recovery remains possible when the old host is gone.
      // The explicit target still must be empty, isolated and locally marked.
      return;
    }
    const [left, right] = await Promise.all([targetIdentity(client), targetIdentity(target)]);
    if (left.clusterId === right.clusterId && left.databaseOid === right.databaseOid) {
      throw new FullRestoreRefusal("The active application database cannot be a restore target.");
    }
  } finally {
    await client.end();
  }
}

async function requireEmptyDirectory(path: string): Promise<void> {
  try {
    if (!(await lstat(path)).isDirectory())
      throw new FullRestoreRefusal(
        "The restore directory must be a real directory, without symlinks.",
      );
    if ((await readdir(path)).length !== 0)
      throw new FullRestoreRefusal("The restore directory is not empty.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Resolve existing parent symlinks even when the requested leaf is new. */
async function prospectivePath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(await prospectivePath(parent), basename(absolute));
  }
}

async function refuseActiveDirectory(target: string, active: string): Promise<void> {
  const [targetPath, activePath] = await Promise.all([
    prospectivePath(target),
    prospectivePath(active),
  ]);
  const contains = (parent: string, child: string) => {
    const path = relative(parent, child);
    return path === "" || (!(path === ".." || path.startsWith(`..${sep}`)) && !isAbsolute(path));
  };
  if (contains(activePath, targetPath) || contains(targetPath, activePath))
    throw new FullRestoreRefusal(
      "The restore directory must be separate from active file storage.",
    );
}

export interface FullRestoreOptions {
  readonly archivePath: string;
  readonly workingDirectory: string;
  readonly targetDirectory: string;
  readonly targetConnectionString: string;
  readonly activeConnectionString: string;
  readonly activeDirectory: string;
  readonly key: Uint8Array;
  /** Explicit read keys for isolated rehearsals only; the CLI apply path supplies none. */
  readonly historicalArchiveKeys?: readonly Uint8Array[];
  readonly dryRun?: boolean;
  readonly tools?: PostgresFullBackupTools;
}

export async function restoreFullBackup(
  options: FullRestoreOptions,
): Promise<{ backupId: string; dryRun: boolean; activationRequired: boolean }> {
  const archive = await VerifiedFullArchive.open(
    options.archivePath,
    options.key,
    options.workingDirectory,
    options.historicalArchiveKeys,
  );
  const tools = options.tools ?? new PostgresFullBackupTools();
  const client = new pg.Client({
    connectionString: options.targetConnectionString,
    connectionTimeoutMillis: 15_000,
  });
  let release: (() => Promise<void>) | undefined;
  try {
    await refuseActiveDirectory(options.targetDirectory, options.activeDirectory);
    await tools.checkVersions(options.targetConnectionString);
    await client.connect();
    release = await acquireFullBackupLocks(client);
    await refuseActiveTarget(
      client,
      options.activeConnectionString,
      options.targetConnectionString,
    );
    if ((await inspectFullSource(client)).nonempty)
      throw new FullRestoreRefusal("The restore database is not empty.");
    await requireEmptyDirectory(options.targetDirectory);
    const identity = await targetIdentity(client);
    if (options.dryRun === true)
      return { backupId: archive.manifest.backupId, dryRun: true, activationRequired: false };
    await mkdir(options.targetDirectory, { recursive: true, mode: 0o700 });
    // Claim the empty directory before the first target write. A competing
    // restore cannot claim it after this exclusive creation.
    const marker = await open(join(options.targetDirectory, FULL_RESTORE_MARKER), "wx", 0o600);
    await marker.close();
    const state: FullRestoreState = {
      formatVersion: 1,
      backupId: archive.manifest.backupId,
      stage: "incomplete",
      ...identity,
    };
    await writeFullRestoreState(options.targetDirectory, state, options.key);
    for (const [index, component] of archive.manifest.components.entries()) {
      if (component.kind === "database") continue;
      const path = join(options.targetDirectory, component.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const handle = await open(path, "wx", 0o600);
      try {
        await pipeline(
          Readable.from(archive.component(index)),
          createWriteStream(path, { fd: handle.fd, autoClose: false }),
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      const parent = await open(dirname(path), "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    }
    await tools.restore(options.targetConnectionString, archive.component(0));
    const restored = await inspectFullSource(client);
    if (
      restored.source.installationId !== archive.manifest.source.installationId ||
      JSON.stringify(restored.source.appliedMigrations) !==
        JSON.stringify(archive.manifest.source.appliedMigrations)
    ) {
      throw new Error("The restored database provenance does not match the verified archive.");
    }
    await writeFullRestoreState(
      options.targetDirectory,
      { ...state, stage: "data-restored" },
      options.key,
    );
    return { backupId: archive.manifest.backupId, dryRun: false, activationRequired: true };
  } finally {
    try {
      await release?.();
    } finally {
      try {
        await client.end();
      } finally {
        await archive.close();
      }
    }
  }
}

/** Host authorization opens the server barrier, never any historical session. */
export async function activateFullRestore(input: {
  targetDirectory: string;
  targetConnectionString: string;
  key: Uint8Array;
}): Promise<{
  backupId: string;
  sessionsInvalidated: number;
  devicesRequireAuthentication: number;
}> {
  const state = await readFullRestoreState(input.targetDirectory, input.key);
  if (state.stage !== "data-restored")
    throw new FullRestoreRefusal("An incomplete restoration cannot be activated.");
  const client = new pg.Client({
    connectionString: input.targetConnectionString,
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    const identity = await targetIdentity(client);
    if (
      identity.databaseName !== state.databaseName ||
      identity.databaseOid !== state.databaseOid ||
      identity.clusterId !== state.clusterId
    )
      throw new FullRestoreRefusal("The restore marker belongs to a different target database.");
    await client.query("BEGIN");
    let sessionsInvalidated = 0;
    let devicesRequireAuthentication = 0;
    try {
      const tables = await client.query<{
        sessions: string | null;
        devices: string | null;
        bootstrap: string | null;
        kits: string | null;
      }>(
        "SELECT to_regclass('public.sessions')::text AS sessions, to_regclass('public.authorized_devices')::text AS devices, to_regclass('public.bootstrap_attempts')::text AS bootstrap, to_regclass('public.recovery_kits')::text AS kits",
      );
      if (tables.rows[0]?.sessions != null)
        sessionsInvalidated =
          (
            await client.query(
              "UPDATE public.sessions SET state = 'revoked', revoked_at = now() WHERE state <> 'revoked'",
            )
          ).rowCount ?? 0;
      if (tables.rows[0]?.devices != null)
        devicesRequireAuthentication =
          (
            await client.query(
              "UPDATE public.authorized_devices SET state = 'reauthorization-required' WHERE state IN ('active', 'pending')",
            )
          ).rowCount ?? 0;
      if (tables.rows[0]?.bootstrap != null) {
        await client.query(
          `UPDATE public.bootstrap_attempts SET
          capability_hash = $1, challenge_hash = NULL,
          download_expires_at = CASE WHEN download_expires_at IS NULL THEN NULL ELSE now() END,
          bootstrap_state = CASE WHEN bootstrap_state IN ('started', 'credential-verified', 'recovery-prepared', 'download-consumed') THEN 'abandoned' ELSE bootstrap_state END,
          updated_at = now()`,
          [randomBytes(32).toString("hex")],
        );
      }
      if (tables.rows[0]?.kits != null) {
        await client.query(`UPDATE public.recovery_kits SET download_token_hash = NULL,
          download_expires_at = CASE WHEN download_expires_at IS NULL THEN NULL ELSE now() END,
          delivery_state = CASE WHEN authorization_state = 'provisional' THEN 'expired' ELSE delivery_state END,
          authorization_state = CASE WHEN authorization_state = 'provisional' THEN 'rejected' ELSE authorization_state END`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    await rm(join(input.targetDirectory, FULL_RESTORE_MARKER));
    const directory = await open(input.targetDirectory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return { backupId: state.backupId, sessionsInvalidated, devicesRequireAuthentication };
  } finally {
    await client.end();
  }
}
