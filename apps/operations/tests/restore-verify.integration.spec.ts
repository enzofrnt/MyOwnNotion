import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupProcessRuntime } from "../src/backup.ts";
import { main } from "../src/cli.ts";
import type { BackupManifest } from "../src/manifest.ts";
import { serializeBackupManifest } from "../src/manifest.ts";
import type {
  ExternalJsonProcessResult,
  ExternalProcessOptions,
  ExternalProcessResult,
} from "../src/process-runner.ts";
import { verifyBackupForRestore } from "../src/restore.ts";

const SNAPSHOT_ID = "deadbeef01234567";
const CONTENT_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd7";
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type Fault =
  | "none"
  | "incomplete-tag"
  | "decrypt"
  | "staged-manifest"
  | "schema"
  | "dump-digest"
  | "object-digest"
  | "extra-file"
  | "archive";

class RestoreRuntime implements BackupProcessRuntime {
  readonly dumpBytes = new TextEncoder().encode("custom postgres dump");
  readonly objectBytes = new TextEncoder().encode("verified private object");

  constructor(private readonly fault: Fault) {}

  async runJson<T>(
    options: ExternalProcessOptions,
    parse: (value: unknown) => T,
  ): Promise<ExternalJsonProcessResult<T>> {
    if (options.executable !== "restic") throw new Error("unexpected JSON command");
    try {
      return {
        ok: true,
        exitCode: 0,
        value: parse([
          {
            id: SNAPSHOT_ID,
            time: "2026-08-08T00:00:00.000Z",
            tags:
              this.fault === "incomplete-tag" ? ["myownnotion-staged"] : ["myownnotion-complete"],
          },
        ]),
      };
    } catch {
      return { ok: false, exitCode: 0, failureCode: options.failureCode };
    }
  }

  async run(options: ExternalProcessOptions): Promise<ExternalProcessResult> {
    if (options.executable === "restic" && options.arguments[0] === "restore") {
      if (this.fault === "decrypt") {
        return { ok: false, exitCode: 1, failureCode: options.failureCode };
      }
      const targetIndex = options.arguments.indexOf("--target");
      const target = options.arguments[targetIndex + 1];
      if (target === undefined) throw new Error("missing restore target");
      const objectPath = `objects/${digest(this.objectBytes).slice(0, 2)}/${CONTENT_ID}`;
      const manifest: BackupManifest = {
        manifestVersion: 1,
        product: "myownnotion",
        createdAt: "2026-08-08T00:00:00.000Z",
        sourceRevision: "a".repeat(40),
        databaseSchemaVersions:
          this.fault === "schema"
            ? ["0001_content_foundations", "0002_content_types"]
            : ["0001_content_foundations"],
        toolVersions: { node: "24.14.0", postgres: "18.4", restic: "0.18.1", rclone: "1.72.1" },
        database: {
          path: "database/myownnotion.dump",
          format: "postgresql-custom",
          byteLength: this.dumpBytes.byteLength,
          sha256: this.fault === "dump-digest" ? "0".repeat(64) : digest(this.dumpBytes),
        },
        objects: [
          {
            contentId: CONTENT_ID,
            storageKey: digest(this.objectBytes),
            path: objectPath,
            byteLength: this.objectBytes.byteLength,
            sha256: this.fault === "object-digest" ? "0".repeat(64) : digest(this.objectBytes),
          },
        ],
        counts: {
          workspaces: 1,
          items: 2,
          placements: 2,
          revisions: 2,
          relationships: 0,
          pageDocuments: 1,
          logicalFiles: 1,
          contentObjects: 1,
        },
        status: this.fault === "staged-manifest" ? "staged" : "complete",
      };
      await mkdir(path.join(target, "database"), { recursive: true });
      await mkdir(path.dirname(path.join(target, objectPath)), { recursive: true });
      await writeFile(path.join(target, "manifest.json"), serializeBackupManifest(manifest));
      await writeFile(path.join(target, manifest.database.path), this.dumpBytes);
      await writeFile(path.join(target, objectPath), this.objectBytes);
      if (this.fault === "extra-file") await writeFile(path.join(target, "private.txt"), "extra");
    }
    if (options.executable === "pg_restore" && this.fault === "archive") {
      return { ok: false, exitCode: 1, failureCode: options.failureCode };
    }
    return { ok: true, exitCode: 0 };
  }
}

async function fixture(fault: Fault): Promise<Parameters<typeof verifyBackupForRestore>[0]> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mon-restore-verify-"));
  roots.push(root);
  const migrationsRoot = path.join(root, "migrations");
  await mkdir(migrationsRoot, { recursive: true });
  await writeFile(path.join(migrationsRoot, "0001_content_foundations.sql"), "SELECT 1;\n");
  return {
    snapshotId: SNAPSHOT_ID,
    stagingRoot: path.join(root, "staging"),
    lockPath: path.join(root, "state", "operations.lock"),
    migrationsRoot,
    postgresMajor: 18,
    environment: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      RESTIC_REPOSITORY: "rclone:offsite:private",
      RESTIC_PASSWORD_FILE: "/run/secrets/restic-password",
    },
    processRuntime: new RestoreRuntime(fault),
    now: () => new Date("2026-08-08T00:00:01.000Z"),
  };
}

describe("restore verification preflight", () => {
  it("accepts one complete compatible snapshot only after dump and every object verify", async () => {
    expect(await verifyBackupForRestore(await fixture("none"))).toMatchObject({
      command: "restore.verify",
      status: "succeeded",
      snapshotId: SNAPSHOT_ID,
      counts: { objects: 1, workspaces: 1, items: 2 },
      failureCode: null,
    });
  });

  it.each([
    ["incomplete-tag", "restore.snapshot-unavailable"],
    ["decrypt", "restore.decrypt-failed"],
    ["staged-manifest", "restore.manifest-incomplete"],
    ["schema", "backup.schema-incompatible"],
    ["dump-digest", "restore.database-integrity-failed"],
    ["object-digest", "restore.object-integrity-failed"],
    ["extra-file", "restore.staging-inventory-mismatch"],
    ["archive", "restore.database-archive-invalid"],
  ] as const)("fails closed for %s", async (fault, failureCode) => {
    const result = await verifyBackupForRestore(await fixture(fault));
    expect(result).toMatchObject({ status: "failed", failureCode });
    expect(JSON.stringify(result)).not.toMatch(/offsite|storageKey|private\.txt|restic-password/);
  });

  it("returns a safe failure without echoing an invalid snapshot identity", async () => {
    const input = await fixture("none");
    const result = await verifyBackupForRestore({ ...input, snapshotId: "../private" });
    expect(result).toMatchObject({
      command: "restore.verify",
      status: "failed",
      failureCode: "restore.snapshot-invalid",
    });
    expect(result).not.toHaveProperty("snapshotId");
  });

  it.each([
    [["restore", "verify"], "restore.snapshot-required"],
    [["restore", "verify", "--snapshot", "../private"], "restore.snapshot-invalid"],
    [
      ["restore", "verify", "--snapshot", SNAPSHOT_ID],
      "restore.postgres-major-invalid",
      { MYOWNNOTION_POSTGRES_MAJOR: "not-a-number" },
    ],
    [["restore", "apply", "--snapshot", SNAPSHOT_ID], "restore.confirmation-required"],
    [
      ["restore", "apply", "--snapshot", SNAPSHOT_ID, "--confirm-empty"],
      "restore.database-required",
    ],
  ] as const)(
    "classifies invalid CLI preflight options as exit 2",
    async (argv, failureCode, environment) => {
      const writes: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        writes.push(String(chunk));
        return true;
      });
      expect(await main(argv, environment ?? {})).toBe(2);
      expect(JSON.parse(writes.at(-1) ?? "{}")).toEqual({ status: "failed", failureCode });
    },
  );
});
