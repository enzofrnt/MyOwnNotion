import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runAdminCli } from "../src/admin/admin-cli.ts";
import { EXIT_CODES } from "../src/admin/command-output.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let directory: string;

beforeAll(async () => {
  harness = await createApiHarness();
  directory = await mkdtemp(path.join(os.tmpdir(), "mon-admin-cli-"));
  const keyFile = path.join(directory, "deployment-key");
  await writeFile(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
  vi.stubEnv("DATABASE_URL", harness.postgres.connectionString);
  vi.stubEnv("MYOWNNOTION_DEPLOYMENT_KEY_FILE", keyFile);
  vi.stubEnv("MYOWNNOTION_BACKUP_ROOT", path.join(directory, "backups"));
  vi.stubEnv("MYOWNNOTION_BLOB_ROOT", path.join(directory, "blobs"));
  vi.stubEnv("TZ", "UTC");
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await harness?.close();
  await rm(directory, { recursive: true, force: true });
});

describe("the unified local administration entrypoint", () => {
  it("prints help without opening infrastructure", async () => {
    const output: string[] = [];
    expect(await runAdminCli(["--help"], (line) => output.push(line))).toBe(EXIT_CODES.ok);
    expect(output.join("\n")).toContain("backup run");
  });

  it("runs and then verifies a real backup through JSON output", async () => {
    const created: string[] = [];
    expect(await runAdminCli(["backup", "run", "--json"], (line) => created.push(line))).toBe(
      EXIT_CODES.ok,
    );
    const body = JSON.parse(created.at(-1) ?? "{}") as { data?: { backupId?: string } };
    expect(body.data?.backupId).toMatch(/^[0-9a-f-]{36}$/);

    const checked: string[] = [];
    expect(
      await runAdminCli(["backup", "verify", "--latest", "--json"], (line) => checked.push(line)),
    ).toBe(EXIT_CODES.ok);
    expect(JSON.parse(checked.at(-1) ?? "{}")).toMatchObject({ ok: true, code: 0 });
  });

  it("renders command and configuration errors with stable exit codes", async () => {
    const unknown: string[] = [];
    expect(await runAdminCli(["backup", "explode"], (line) => unknown.push(line))).toBe(
      EXIT_CODES.usage,
    );
    expect(unknown.join("\n")).toMatch(/unknown command/i);

    vi.stubEnv("MYOWNNOTION_BACKUP_DESTINATION", "unknown");
    const invalid: string[] = [];
    expect(await runAdminCli(["version", "inspect", "--json"], (line) => invalid.push(line))).toBe(
      EXIT_CODES.usage,
    );
    expect(JSON.parse(invalid.at(-1) ?? "{}")).toMatchObject({ ok: false, code: 2 });
    vi.stubEnv("MYOWNNOTION_BACKUP_DESTINATION", "filesystem");
  });
});
