import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readDatabaseRecord, schema } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FULL_RESTORE_MARKER, writeFullRestoreState } from "../src/backup/full/restore-state.ts";
import { applyNotionImport } from "../src/imports/notion/apply.ts";
import { runNotionImportCli } from "../src/imports/notion/cli.ts";
import { importId } from "../src/imports/notion/model.ts";
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
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture value missing");
  return value;
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
  it("rejects invalid plans before backup or target access", async () => {
    const imported = await plan({ "Page.md": "# Valid" });
    const inaccessible = {
      ...target,
      get context(): NotionTarget["context"] {
        throw new Error("target accessed before validation");
      },
    } as NotionTarget;
    const blocked = structuredClone(imported.value);
    blocked.report.issues.push({
      code: "test.blocked-source",
      sourcePath: "Page.md",
      blocking: true,
    });
    await expect(applyNotionImport(blocked, inaccessible)).rejects.toMatchObject({
      code: "import.preview-blocked",
    });
    const invalid = structuredClone(imported.value);
    required(invalid.pages[0]).document = {
      ...required(invalid.pages[0]).document,
      formatVersion: 999,
    };
    await expect(applyNotionImport(invalid, inaccessible)).rejects.toMatchObject({
      code: "import.invalid-document",
    });
    const database = await plan({ "Data.csv": "Name,Status\nEntry,Done\n" });
    const source = required(database.value.databases[0]);
    source.definition = { ...source.definition, properties: [] };
    await expect(applyNotionImport(database.value, inaccessible)).rejects.toMatchObject({
      code: "import.invalid-definition",
    });
    expect(await countItems()).toBe(0);
  });

  it("returns the canonical refusal when a planned folder parent is unavailable", async () => {
    const imported = await plan({ "Page.md": "# Rejected page" });
    required(imported.value.folders[0]).parentId = generateUuidV7();
    await expect(applyNotionImport(imported.value, target)).rejects.toMatchObject({
      code: "containment.parent-not-found",
    });
    expect(await countItems()).toBe(0);
    expect(
      await target.runtime.records.read(target.context.db, {
        entityType: "import.step",
        entityId: importId(imported.value.id, `operation:folder:${imported.value.rootId}`),
      }),
    ).toBeNull();
  }, 180_000);
  it("completes an empty source through the human-readable CLI with a safety backup", async () => {
    const imported = await plan({});
    const lines: string[] = [];
    expect(
      await runNotionImportCli(
        ["--source", imported.directory, "--id", imported.value.id, "--apply"],
        (line) => lines.push(line),
        {
          DATABASE_URL: harness.api.postgres.connectionString,
          MYOWNNOTION_BLOB_ROOT: harness.api.blobRoot,
          MYOWNNOTION_DEPLOYMENT_KEY_FILE: harness.deploymentKeyFile,
          MYOWNNOTION_BACKUP_ROOT: join(root, "empty-backups"),
        },
      ),
    ).toBe(0);
    expect(lines.at(-1)).toContain(
      `Import ${imported.value.id}: complete; root ${imported.value.rootId}; safety backup `,
    );
    expect(await countItems()).toBe(imported.value.folders.length);
    expect(await target.context.db.select().from(schema.logicalFiles)).toEqual([]);
  }, 180_000);
  it("resumes a committed file without publishing another revision or copy", async () => {
    const imported = await plan({
      "Page.md": "# Pending document",
      "asset.pdf": new Uint8Array([1, 2, 3]),
    });
    const file = required(imported.value.files[0]);
    const mutationId = importId(imported.value.id, `operation:file:${file.id}`);
    await expect(
      applyNotionImport(imported.value, target, {
        afterOperation: async () => {
          const [published] = await target.context.db
            .select()
            .from(schema.mutations)
            .where(eq(schema.mutations.id, mutationId));
          if (published) throw new Error("pause after durable file publication");
        },
      }),
    ).rejects.toThrow("pause after durable file");
    const revisions = await target.context.db
      .select()
      .from(schema.revisions)
      .where(eq(schema.revisions.itemId, file.id));
    const stored = await target.context.db
      .select()
      .from(schema.logicalFiles)
      .where(eq(schema.logicalFiles.itemId, file.id));
    const result = await applyNotionImport(imported.value, target);
    expect(result.alreadyComplete).toBe(false);
    expect(
      await target.context.db
        .select()
        .from(schema.revisions)
        .where(eq(schema.revisions.itemId, file.id)),
    ).toEqual(revisions);
    expect(
      await target.context.db
        .select()
        .from(schema.logicalFiles)
        .where(eq(schema.logicalFiles.itemId, file.id)),
    ).toEqual(stored);
    expect(
      JSON.stringify((await item(required(imported.value.pages[0]).id)).pageDocument),
    ).toContain("Pending document");
  }, 180_000);
  it("rolls back refused file publication and leaves its checkpoint absent", async () => {
    const imported = await plan({ "asset.pdf": new Uint8Array([42, 12, 8]) });
    const file = required(imported.value.files[0]);
    file.parentId = generateUuidV7();
    await expect(applyNotionImport(imported.value, target)).rejects.toMatchObject({
      name: "DomainRejection",
    });
    expect(
      await target.context.db.select().from(schema.items).where(eq(schema.items.id, file.id)),
    ).toEqual([]);
    expect(
      await target.context.db
        .select()
        .from(schema.logicalFiles)
        .where(eq(schema.logicalFiles.itemId, file.id)),
    ).toEqual([]);
    expect(
      await target.context.db
        .select()
        .from(schema.revisions)
        .where(eq(schema.revisions.itemId, file.id)),
    ).toEqual([]);
    const mutationId = importId(imported.value.id, `operation:file:${file.id}`);
    expect(
      await target.context.db
        .select()
        .from(schema.mutations)
        .where(eq(schema.mutations.id, mutationId)),
    ).toEqual([]);
    expect(
      await target.runtime.records.read(target.context.db, {
        entityType: "import.step",
        entityId: mutationId,
      }),
    ).toBeNull();
    expect(await readFile(join(imported.directory, "asset.pdf"))).toEqual(Buffer.from([42, 12, 8]));
  }, 180_000);
  it.each(["folder", "file"] as const)(
    "refuses an unowned %s mutation identity instead of replaying it",
    async (kind) => {
      const imported = await plan({ "asset.pdf": new Uint8Array([42]) });
      const id = kind === "folder" ? imported.value.rootId : required(imported.value.files[0]).id;
      const mutationId = importId(imported.value.id, `operation:${kind}:${id}`);
      await target.context.db.insert(schema.mutations).values({
        id: mutationId,
        workspaceId: target.context.workspaceId,
        commandType: kind === "folder" ? "item.create" : "file.import",
        status: "accepted",
        acceptedAt: new Date(),
        resultRevisionIds: [generateUuidV7()],
      });
      await expect(applyNotionImport(imported.value, target)).rejects.toMatchObject({
        code: "import.identity-conflict",
      });
      expect(
        await target.runtime.records.read(target.context.db, {
          entityType: "import.step",
          entityId: mutationId,
        }),
      ).toBeNull();
      expect(
        await target.context.db.select().from(schema.items).where(eq(schema.items.id, id)),
      ).toEqual([]);
    },
    180_000,
  );
  it("refuses a tampered encrypted checkpoint before resuming any canonical write", async () => {
    const imported = await plan({ "Page.md": "# Private checkpoint" });
    await expect(
      applyNotionImport(imported.value, target, {
        afterOperation: async () => {
          throw new Error("pause");
        },
      }),
    ).rejects.toThrow("pause");
    const [envelope] = await target.context.db
      .select()
      .from(schema.protectedEnvelopes)
      .where(
        and(
          eq(schema.protectedEnvelopes.entityType, "import.job"),
          eq(schema.protectedEnvelopes.entityId, imported.value.id),
        ),
      );
    expect(envelope).toBeDefined();
    const bytes = Buffer.from(required(envelope).ciphertext, "base64");
    bytes[0] = bytes.readUInt8(0) ^ 1;
    await target.context.db
      .update(schema.protectedEnvelopes)
      .set({ ciphertext: bytes.toString("base64") })
      .where(eq(schema.protectedEnvelopes.id, required(envelope).id));
    const before = await target.context.db.select().from(schema.mutations);
    const blobs = (await readdir(harness.api.blobRoot, { recursive: true })).sort();
    await expect(applyNotionImport(imported.value, target)).rejects.toThrow();
    expect(await target.context.db.select().from(schema.mutations)).toEqual(before);
    expect((await readdir(harness.api.blobRoot, { recursive: true })).sort()).toEqual(blobs);
  }, 180_000);
  it("refuses a target without a ready installation or a complete migration inventory", async () => {
    const options = {
      connectionString: harness.api.postgres.connectionString,
      blobRoot: harness.api.blobRoot,
      keyFile: harness.deploymentKeyFile,
      backupRoot: join(root, "unused-backups"),
    };
    await target.context.db.update(schema.installations).set({ state: "recovery-required" });
    await expect(openNotionTarget(options)).rejects.toMatchObject({
      code: "import.target-not-ready",
    });
    await target.context.db
      .update(schema.installations)
      .set({ state: "ready", workspaceId: generateUuidV7() });
    await expect(openNotionTarget(options)).rejects.toMatchObject({
      code: "import.target-not-ready",
    });
    await expect(target.context.db.transaction((tx) => target.ready(tx))).rejects.toMatchObject({
      code: "import.target-not-ready",
    });
    await target.context.db
      .update(schema.installations)
      .set({ workspaceId: target.context.workspaceId });
    const removed = await target.context.db.execute<{ version: string }>(
      sql`DELETE FROM schema_migrations WHERE version = (SELECT max(version) FROM schema_migrations) RETURNING version`,
    );
    try {
      await expect(openNotionTarget(options)).rejects.toMatchObject({
        code: "import.pending-migrations",
      });
    } finally {
      await target.context.db.execute(
        sql`INSERT INTO schema_migrations (version) VALUES (${required(removed.rows[0]).version})`,
      );
    }
    expect(await countItems()).toBe(0);
  });

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
    expect(
      await runNotionImportCli(
        argv.filter((arg) => arg !== "--json"),
        (line) => lines.push(line),
        env,
      ),
    ).toBe(0);
    expect(lines.at(-1)).toContain("already complete; root");
    expect(lines.at(-1)).not.toContain("CLI imported page");
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

it("imports same-title native entries into their own sources and leaves an unrelated note independent", async () => {
  const imported = await plan({
    "Task.md": "# Task\nIndependent note body\n",
    "Tasks.csv": "Name,Status\nTask,Done\n",
    "Tasks/Task abcdef0123456789abcdef0123456789.md": "# Task\nFirst source body\n",
    "Other.csv": "Name,Status\nTask,Todo\n",
    "Other/Task fedcba9876543210fedcba9876543210.md": "# Task\nSecond source body\n",
  });
  expect(imported.value.report.issues.filter((issue) => issue.blocking)).toEqual([]);
  await applyNotionImport(imported.value, target);
  const independent = required(imported.value.pages.find((page) => page.path === "Task.md"));
  const rows = await target.context.db.select().from(schema.databaseEntries);
  expect(rows).toHaveLength(2);
  expect(rows.some((row) => row.entryItemId === independent.id)).toBe(false);
  expect(JSON.stringify((await item(independent.id)).pageDocument)).toContain(
    "Independent note body",
  );
  for (const [path, body] of [
    ["Tasks.csv", "First source body"],
    ["Other.csv", "Second source body"],
  ]) {
    const source = required(imported.value.databases.find((source) => source.path === path));
    const entryId = required(source.memberIds[0]);
    expect(rows).toContainEqual(
      expect.objectContaining({ databaseId: source.id, entryItemId: entryId }),
    );
    expect(JSON.stringify((await item(entryId)).pageDocument)).toContain(body);
    const response = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/databases/${source.id}/entries/${entryId}`,
      headers,
    });
    expect(response.statusCode, response.body).toBe(200);
  }
  expect((await applyNotionImport(imported.value, target)).alreadyComplete).toBe(true);
  expect(await target.context.db.select().from(schema.databaseEntries)).toEqual(rows);
}, 180_000);
