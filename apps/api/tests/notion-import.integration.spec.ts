import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readDatabaseRecord, schema } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FULL_RESTORE_MARKER, writeFullRestoreState } from "../src/backup/full/restore-state.ts";
import { applyNotionImport } from "../src/imports/notion/apply.ts";
import { runNotionImportCli } from "../src/imports/notion/cli.ts";
import { planNotionImport } from "../src/imports/notion/plan.ts";
import { readImportSource } from "../src/imports/notion/source.ts";
import { type NotionTarget, openNotionTarget } from "../src/imports/notion/target.ts";
import { loadDeploymentKey } from "../src/security/deployment-key.ts";
import { createItemViaApi } from "./helpers/app.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
} from "./helpers/authenticated-page-operations.ts";

let harness: AuthenticatedPageOperationHarness;
let target: NotionTarget;
let root: string;
let headers: Record<string, string>;
beforeAll(async () => {
  harness = await createAuthenticatedPageOperationHarness();
  root = await mkdtemp(join(tmpdir(), "notion-import-integration-"));
  await harness.reset();
  await harness.authenticate();
  target = await openNotionTarget({
    connectionString: harness.api.postgres.connectionString,
    blobRoot: harness.api.blobRoot,
    keyFile: harness.deploymentKeyFile,
    backupRoot: join(root, "backups"),
  });
}, 180_000);
afterAll(async () => {
  await target?.close();
  await harness?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await harness.reset();
  headers = await harness.authenticate();
});
async function plan(files: Record<string, string | Uint8Array>) {
  const directory = await mkdtemp(join(root, "source-"));
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), bytes);
  }
  return {
    directory,
    value: planNotionImport(await readImportSource(directory), generateUuidV7()),
  };
}
async function countItems() {
  return (
    (
      await target.context.db.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM items`,
      )
    ).rows[0]?.count ?? 0
  );
}
async function item(id: string) {
  const response = await harness.api.built.app.inject({
    method: "GET",
    url: `/v1/items/${id}`,
    headers,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
describe("protected canonical Notion apply", () => {
  it("publishes ordinary pages, links and encrypted original/file bytes after a real full safety backup", async () => {
    await createItemViaApi(harness.api, { kind: "page", name: "Existing owner page", headers });
    const imported = await plan({
      "Home.md": "# Private imported home\n[[Child]]\n![[picture.png]]\n",
      "Child.md": "# Child\nConfidential paragraph\n",
      "picture.png": new Uint8Array([137, 80, 78, 71, 19, 21]),
    });
    const before = await readFile(join(imported.directory, "Child.md"));
    const result = await applyNotionImport(imported.value, target);
    expect(result.backupId).toBeTruthy();
    expect(result.completed).toBeGreaterThan(5);
    const home = imported.value.pages.find((page) => page.path === "Home.md");
    expect(home).toBeDefined();
    const read = await item(home?.id ?? "");
    expect(JSON.stringify(read.pageDocument)).toContain("pageLink");
    expect(JSON.stringify(read.pageDocument)).toContain("fileEmbed");
    const file = imported.value.files.find((file) => file.path === "picture.png");
    const [logical] = await target.context.db
      .select()
      .from(schema.logicalFiles)
      .where(eq(schema.logicalFiles.itemId, file?.id ?? ""));
    expect(logical).toBeDefined();
    const chunks: Buffer[] = [];
    for await (const chunk of target.runtime.files.read(
      target.context.db,
      logical?.contentId ?? "",
    ))
      chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([137, 80, 78, 71, 19, 21]));
    const stored = await target.context.db.execute(
      sql`SELECT i.name,p.body FROM items i LEFT JOIN page_documents p ON p.page_id=i.id`,
    );
    expect(JSON.stringify(stored.rows)).not.toContain("Confidential paragraph");
    expect(JSON.stringify(stored.rows)).not.toContain("Private imported home");
    const checkpoint = await target.runtime.records.read(target.context.db, {
      entityType: "import.job",
      entityId: imported.value.id,
    });
    expect(JSON.parse(new TextDecoder().decode(checkpoint ?? new Uint8Array()))).toMatchObject({
      complete: true,
    });
    expect(await readFile(join(imported.directory, "Child.md"))).toEqual(before);
  }, 180_000);
  it("imports one reusable source for two exported Bases displays and retains membership/property values", async () => {
    const imported = await plan({
      "First.md": "# First\n![[First.base]]\n",
      "Second.md": "# Second\n![[Second.base]]\n",
      "First.base":
        'filters:\n  and:\n    - note["base"] == link("Shared")\nviews:\n  - type: table\n    name: First table\n',
      "Second.base":
        'filters:\n  and:\n    - note["base"] == link("Shared")\nviews:\n  - type: table\n    name: Second table\n',
      "Entry.md":
        '---\nbase: "[[Shared]]"\nStatus: Done\nOwner: [Person]\n---\n# Entry\nEntry paragraph\n',
    });
    expect(imported.value.databases).toHaveLength(1);
    await applyNotionImport(imported.value, target);
    const source = imported.value.databases[0];
    const response = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/databases/${source?.id}`,
      headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().definition.embeddings).toHaveLength(2);
    const rows = await target.context.db.select().from(schema.databaseEntries);
    expect(rows).toHaveLength(1);
    const entry = imported.value.pages.find((page) => page.databaseId);
    expect((await item(entry?.id ?? "")).name).toBe("Entry");
    const values = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/databases/${source?.id}/entries/${entry?.id}`,
      headers,
    });
    expect(values.statusCode, values.body).toBe(200);
    expect(values.body).toContain("Person");
    expect(values.body).toContain("status");
  }, 180_000);
  it("resumes committed checkpoints, survives restart and never overwrites later owner edits", async () => {
    const imported = await plan({ "Page.md": "# Original title\nOriginal body\n" });
    await expect(
      applyNotionImport(imported.value, target, {
        afterOperation: async (count) => {
          if (count === 2) throw new Error("simulate process loss");
        },
      }),
    ).rejects.toThrow("simulate");
    const partial = await countItems();
    expect(partial).toBe(2);
    await target.close();
    target = await openNotionTarget({
      connectionString: harness.api.postgres.connectionString,
      blobRoot: harness.api.blobRoot,
      keyFile: harness.deploymentKeyFile,
      backupRoot: join(root, "backups"),
    });
    await applyNotionImport(imported.value, target);
    const count = await countItems();
    const page = imported.value.pages[0];
    const renamed = await harness.api.built.app.inject({
      method: "PATCH",
      url: `/v1/items/${page?.id}`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: {
        baseRevisionId: (await item(page?.id ?? "")).currentRevisionId,
        name: "Owner changed later",
      },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect((await applyNotionImport(imported.value, target)).alreadyComplete).toBe(true);
    expect(await countItems()).toBe(count);
    expect((await item(page?.id ?? "")).name).toBe("Owner changed later");
    await writeFile(join(imported.directory, "Page.md"), "Changed source");
    const changed = planNotionImport(await readImportSource(imported.directory), imported.value.id);
    await expect(applyNotionImport(changed, target)).rejects.toMatchObject({
      code: "import.source-changed",
    });
    expect(await countItems()).toBe(count);
  }, 180_000);
  it("refuses failed backup and stale target edits before publishing the pending document", async () => {
    const imported = await plan({ "Page.md": "# Private\nNever overwrite\n" });
    const before = await countItems();
    await expect(
      applyNotionImport(imported.value, {
        ...target,
        backup: async () => {
          throw new Error("backup failed");
        },
      }),
    ).rejects.toThrow("backup failed");
    expect(await countItems()).toBe(before);
    await expect(
      applyNotionImport(imported.value, target, {
        afterOperation: async (count) => {
          if (count === 3) throw new Error("pause after page create");
        },
      }),
    ).rejects.toThrow("pause");
    const page = imported.value.pages[0];
    const response = await harness.api.built.app.inject({
      method: "PATCH",
      url: `/v1/items/${page?.id}`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: {
        baseRevisionId: (await item(page?.id ?? "")).currentRevisionId,
        name: "Keep owner change",
      },
    });
    expect(response.statusCode).toBe(200);
    await expect(applyNotionImport(imported.value, target)).rejects.toMatchObject({
      code: "import.target-changed",
    });
    expect((await item(page?.id ?? "")).name).toBe("Keep owner change");
  }, 180_000);
  it("previews through the CLI without target settings and keeps dry-run authoritative", async () => {
    const imported = await plan({ "Page.md": "# Secret title\nBody" });
    const lines: string[] = [];
    expect(
      await runNotionImportCli(["--source", imported.directory], (line) => lines.push(line), {}),
    ).toBe(0);
    expect(lines.join()).not.toContain("Secret title");
    expect(await countItems()).toBe(0);
    expect(
      await runNotionImportCli(
        ["--source", imported.directory, "--apply", "--dry-run", "--json"],
        (line) => lines.push(line),
        {},
      ),
    ).toBe(0);
    expect(JSON.parse(lines.at(-1) ?? "{}").files).toHaveLength(1);
    expect(
      await runNotionImportCli(
        ["--source", imported.directory, "--apply"],
        (line) => lines.push(line),
        {},
      ),
    ).toBe(2);
    expect(
      await runNotionImportCli(
        ["--source", imported.directory, "--id", imported.value.id, "--apply"],
        (line) => lines.push(line),
        {},
      ),
    ).toBe(1);
    expect(lines.at(-1)).toBe("import.target-configuration-required");
    expect(await countItems()).toBe(0);
  });
  it("refuses a newer independent source definition on resume", async () => {
    const imported = await plan({
      "Data.base":
        'filters: note.base == link("Data")\nviews:\n  - type: table\n    name: Exported\n',
      "Entry.md": '---\nbase: "[[Data]]"\n---\n# Entry',
    });
    const source = imported.value.databases[0];
    if (!source) throw new Error("fixture source missing");
    await expect(
      applyNotionImport(imported.value, target, {
        afterOperation: async () => {
          const record = await readDatabaseRecord(target.context.db, source.id);
          if (record && record.definitionVersion >= 2) throw new Error("pause after schema");
        },
      }),
    ).rejects.toThrow("pause after schema");
    const before = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/databases/${source.id}`,
      headers,
    });
    expect(before.statusCode).toBe(200);
    const dto = before.json();
    const changed = await harness.api.built.app.inject({
      method: "PUT",
      url: `/v1/databases/${source.id}/definition`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: {
        baseRevisionId: dto.definitionRevisionId,
        definition: { ...dto.definition, name: "Owner source edit" },
      },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    await expect(applyNotionImport(imported.value, target)).rejects.toMatchObject({
      code: "import.target-changed",
    });
    const after = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/databases/${source.id}`,
      headers,
    });
    expect(after.json().definition.name).toBe("Owner source edit");
  }, 180_000);
  it("holds the job lock through interruption and checks write guards before backup", async () => {
    const imported = await plan({ "Page.md": "# Page" });
    const lock = await target.database.pool.connect();
    const key = Buffer.from(imported.value.id.replaceAll("-", ""), "hex").readInt32BE(0);
    await lock.query("SELECT pg_advisory_lock($1, $2)", [2801, key]);
    try {
      await expect(applyNotionImport(imported.value, target)).rejects.toMatchObject({
        code: "import.already-running",
      });
      expect(await countItems()).toBe(0);
    } finally {
      await lock.query("SELECT pg_advisory_unlock($1, $2)", [2801, key]);
      lock.release();
    }
    await target.context.db.update(schema.owners).set({ state: "recovery-required" });
    let backupCalled = false;
    await expect(
      applyNotionImport(imported.value, {
        ...target,
        backup: async () => {
          backupCalled = true;
          return target.backup();
        },
      }),
    ).rejects.toMatchObject({ code: "import.target-not-ready" });
    expect(backupCalled).toBe(false);
    expect(await countItems()).toBe(0);
  });
  it("applies and replays through the explicit configured CLI", async () => {
    const imported = await plan({ "Page.md": "# CLI imported page" });
    const env = {
      DATABASE_URL: harness.api.postgres.connectionString,
      MYOWNNOTION_BLOB_ROOT: harness.api.blobRoot,
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: harness.deploymentKeyFile,
      MYOWNNOTION_BACKUP_ROOT: join(root, "cli-backups"),
    };
    const argv = ["--source", imported.directory, "--id", imported.value.id, "--apply", "--json"];
    const lines: string[] = [];
    expect(await runNotionImportCli(argv, (line) => lines.push(line), env)).toBe(0);
    expect(JSON.parse(lines.at(-1) ?? "{}")).toMatchObject({
      alreadyComplete: false,
      report: { pages: [expect.objectContaining({ title: "CLI imported page" })] },
    });
    const count = await countItems();
    expect(await runNotionImportCli(argv, (line) => lines.push(line), env)).toBe(0);
    expect(JSON.parse(lines.at(-1) ?? "{}").alreadyComplete).toBe(true);
    expect(await countItems()).toBe(count);
  }, 180_000);
  it("transfers typed values and relations through ordinary database readback", async () => {
    const imported = await plan({
      "Work.base":
        'filters: note.base == link("Work")\nviews:\n  - type: table\n    name: Work table\n',
      "Parent.md":
        '---\nbase: "[[Work]]"\nDone: true\nEstimate: 3.5\nDue: 2026-09-05\n---\n# Parent\n',
      "Child.md":
        '---\nbase: "[[Work]]"\nDone: false\nEstimate: 2\nDue: 2026-09-06\nParent task: ["[[Parent]]"]\n---\n# Child\n\n> Quoted **strong** and *emphasis* with ~~strike~~.\n\n- [x] Completed\n  - Nested\n\n1. Ordered\n2. Second\n\n---\n\nInline `[[literal]]`.\n',
    });
    await applyNotionImport(imported.value, target);
    const source = imported.value.databases[0];
    const child = imported.value.pages.find((page) => page.path === "Child.md");
    const parent = imported.value.pages.find((page) => page.path === "Parent.md");
    const response = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/databases/${source?.id}/entries/${child?.id}`,
      headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    const dto = response.json();
    expect(Object.values(dto.relationTargets)).toEqual([[parent?.id]]);
    expect(Object.values(dto.values)).toEqual(
      expect.arrayContaining([
        { kind: "checkbox", checked: false },
        { kind: "number", decimal: "2" },
        { kind: "date", date: "2026-09-06" },
      ]),
    );
    expect(JSON.stringify(dto.document)).toContain("checkbox");
    expect(JSON.stringify(dto.document)).toContain("numberedListItem");
  }, 180_000);
  it("uses the authoritative rotation block before taking a backup or importing content", async () => {
    const imported = await plan({ "Page.md": "# Refused private data" });
    await target.context.db.insert(schema.rotationPolicies).values({
      id: generateUuidV7(),
      installationId: target.installationId,
      kind: "data-key",
      mode: "scheduled",
      dueIntervalDays: 365,
      dueAt: new Date(Date.now() - 172800000),
      writeBlockAt: new Date(Date.now() - 86400000),
      currentGeneration: 1,
      state: "pre-due",
    });
    let backupCalled = false;
    await expect(
      applyNotionImport(imported.value, {
        ...target,
        backup: async () => {
          backupCalled = true;
          return target.backup();
        },
      }),
    ).rejects.toMatchObject({ name: "RotationWriteBlockedError" });
    expect(backupCalled).toBe(false);
    expect(await countItems()).toBe(0);
    const lines: string[] = [];
    expect(
      await runNotionImportCli(
        ["--source", imported.directory, "--id", imported.value.id, "--apply", "--json"],
        (line) => lines.push(line),
        {
          DATABASE_URL: harness.api.postgres.connectionString,
          MYOWNNOTION_BLOB_ROOT: harness.api.blobRoot,
          MYOWNNOTION_DEPLOYMENT_KEY_FILE: join(root, "missing-private-key"),
          MYOWNNOTION_BACKUP_ROOT: join(root, "unused-backups"),
        },
      ),
    ).toBe(1);
    expect(lines).toEqual([JSON.stringify({ code: "import.unavailable" })]);
    expect(await countItems()).toBe(0);
  });
  it("refuses restored targets awaiting activation before open and every resumed operation", async () => {
    const imported = await plan({ "Page.md": "# Restored private source" });
    const snapshot = async () => ({
      counts: (
        await target.context.db.execute(sql`SELECT
        (SELECT count(*) FROM mutations)::int AS mutations,
        (SELECT count(*) FROM revisions)::int AS revisions,
        (SELECT count(*) FROM items)::int AS items,
        (SELECT count(*) FROM changes)::int AS changes`)
      ).rows,
      job: Buffer.from(
        (await target.runtime.records.read(target.context.db, {
          entityType: "import.job",
          entityId: imported.value.id,
        })) ?? [],
      ).toString("base64"),
      blobs: (await readdir(harness.api.blobRoot, { recursive: true })).sort(),
    });
    let before: Awaited<ReturnType<typeof snapshot>> | undefined;
    try {
      await expect(
        applyNotionImport(imported.value, target, {
          afterOperation: async (count) => {
            if (count !== 2) return;
            await writeFullRestoreState(
              harness.api.blobRoot,
              {
                formatVersion: 1,
                backupId: generateUuidV7(),
                stage: "data-restored",
                databaseName: "disposable-import-target",
                databaseOid: 1,
                clusterId: "1",
              },
              loadDeploymentKey(harness.deploymentKeyFile).bytes,
            );
            before = await snapshot();
          },
        }),
      ).rejects.toThrow("awaits local security activation");
      expect(before).toBeDefined();
      expect(await snapshot()).toEqual(before);
      await expect(
        openNotionTarget({
          connectionString: harness.api.postgres.connectionString,
          blobRoot: harness.api.blobRoot,
          keyFile: harness.deploymentKeyFile,
          backupRoot: join(root, "backups"),
        }),
      ).rejects.toThrow("awaits local security activation");
      await expect(applyNotionImport(imported.value, target)).rejects.toThrow(
        "awaits local security activation",
      );
      expect(await snapshot()).toEqual(before);
    } finally {
      await rm(join(harness.api.blobRoot, FULL_RESTORE_MARKER), { force: true });
    }
  }, 180_000);
});
