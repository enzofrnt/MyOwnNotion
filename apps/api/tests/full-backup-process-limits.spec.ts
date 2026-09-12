import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PostgresFullBackupTools } from "../src/backup/full/postgres.ts";

it.skipIf(process.platform === "win32")(
  "bounds a stalled PostgreSQL tool and forcibly stops one that ignores cancellation",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "mon-full-process-"));
    const executable = join(directory, "pg_dump");
    const connection = "postgres://fixture@127.0.0.1:1/unavailable";
    try {
      await writeFile(executable, "#!/usr/bin/env bun\nsetInterval(() => {}, 1000);\n", {
        mode: 0o700,
      });
      await writeFile(
        executable,
        "#!/usr/bin/env bun\nconsole.log('pg_dump (PostgreSQL) 17.6');\n",
        { mode: 0o700 },
      );
      await expect(
        new PostgresFullBackupTools({ binDirectory: directory }).checkVersions(connection),
      ).rejects.toThrow("availability check");
      await writeFile(executable, "#!/usr/bin/env bun\nsetInterval(() => {}, 1000);\n", {
        mode: 0o700,
      });
      const started = Date.now();
      await expect(
        new PostgresFullBackupTools({ binDirectory: directory, timeoutMs: 100 }).checkVersions(
          connection,
        ),
      ).rejects.toThrow("availability check");
      expect(Date.now() - started).toBeLessThan(5000);
      await writeFile(
        executable,
        "#!/usr/bin/env bun\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('x'.repeat(2048));\n",
        { mode: 0o700 },
      );
      const oversized = Date.now();
      await expect(
        new PostgresFullBackupTools({ binDirectory: directory, timeoutMs: 10000 }).checkVersions(
          connection,
        ),
      ).rejects.toThrow("availability check");
      expect(Date.now() - oversized).toBeLessThan(7000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
