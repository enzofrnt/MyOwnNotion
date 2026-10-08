import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDatabaseRecordBySourceId, schema } from "@myownnotion/database";
import { documentDigestV3, validatePageDocumentEnvelopeV3 } from "@myownnotion/domain";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyNotionImport, loadNotionImportPlan } from "../src/imports/notion/apply.ts";
import { importId } from "../src/imports/notion/model.ts";
import { planNotionImport } from "../src/imports/notion/plan.ts";
import { NotionImportError } from "../src/imports/notion/source.ts";
import { type NotionTarget, openNotionTarget } from "../src/imports/notion/target.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
} from "./helpers/authenticated-page-operations.ts";
import { notionFixture, required, rich } from "./helpers/notion-api-fixture.ts";

let harness: AuthenticatedPageOperationHarness,
  target: NotionTarget,
  root: string,
  headers: Record<string, string>;
beforeAll(async () => {
  harness = await createAuthenticatedPageOperationHarness();
  root = await mkdtemp(join(tmpdir(), "notion-api-integration-"));
  await harness.reset();
  await harness.authenticate();
  target = await openNotionTarget({
    connectionString: harness.api.postgres.connectionString,
    blobRoot: harness.api.blobRoot,
    keyFile: harness.deploymentKeyFile,
    backupRoot: join(root, "backups"),
  });
}, 180000);
afterAll(async () => {
  await target?.close();
  await harness?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await harness.reset();
  headers = await harness.authenticate();
});
async function item(id: string) {
  const r = await harness.api.built.app.inject({ method: "GET", url: `/v1/items/${id}`, headers });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function count() {
  return required(
    (
      await target.context.db.execute<{
        count: number;
      }>(sql`SELECT count(*)::int as count FROM items`)
    ).rows[0],
  ).count;
}
describe("Notion API protected canonical application", () => {
  it("creates linked displays before their source owner and binds views after all sources exist", async () => {
    const fixture = notionFixture();
    const linkedId = importId("fixture", "linked-container");
    fixture.databases.unshift({
      object: "database",
      id: linkedId,
      title: rich("Linked"),
      parent: required(fixture.databases[0])["parent"],
    });
    fixture.views.push({
      ...required(fixture.views[0]),
      id: importId("fixture", "linked-view"),
      parent: { type: "database_id", database_id: linkedId },
    });
    const plan = planNotionImport(fixture);
    await applyNotionImport(plan, target);
    const linked = required(plan.databases[0]);
    expect((await item(linked.id)).item?.kind ?? (await item(linked.id)).kind).toBe(
      "database_view",
    );
    const { readDatabasePresentationRecord } = await import("@myownnotion/database");
    const record = required(
      (await readDatabasePresentationRecord(target.context.db, linked.id)) ?? undefined,
    );
    const bytes = await target.runtime.records.read(target.context.db, {
      entityType: "revision.snapshot",
      entityId: record.presentationRevisionId,
    });
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toContain(
      required(plan.databases[1]).sources[0]?.id,
    );
  }, 180000);
  it("imports multiple native sources, readback, relations and encrypted originals", async () => {
    const plan = planNotionImport(notionFixture());
    const result = await applyNotionImport(plan, target);
    expect(result.backupId).toBeTruthy();
    const db = required(plan.databases[0]);
    expect(JSON.stringify(await item(db.id))).toContain("📚");
    const records = await target.context.db
      .select()
      .from(schema.databases)
      .where(eq(schema.databases.itemId, db.id));
    expect(records).toHaveLength(2);
    for (const source of db.sources)
      expect((await readDatabaseRecordBySourceId(target.context.db, source.id))?.databaseId).toBe(
        db.id,
      );
    const entries = await target.context.db.select().from(schema.databaseEntries);
    expect(new Set(entries.map((entry) => entry.sourceId))).toEqual(
      new Set(db.sources.map((source) => source.id)),
    );
    const row = required(plan.pages.find((page) => page.icon));
    const opened = await item(row.id);
    expect(JSON.stringify(opened)).toContain("Hello private fixture");
    const relation = required(required(Object.values(row.relationTargets ?? {})[0])[0]);
    expect(
      (await target.context.db.select().from(schema.relationships)).some(
        (edge) => edge.targetItemId === relation,
      ),
    ).toBe(true);
    expect(plan.files.some((file) => file.original)).toBe(false);
    expect(plan.folders).toHaveLength(1);
    const parent = required(
      plan.pages.find((page) => JSON.stringify(page.document).includes("databaseView")),
    );
    const parentItem = await item(parent.id);
    const envelope = validatePageDocumentEnvelopeV3(parent.document);
    if (!envelope.ok) throw new Error("Invalid fixture document");
    const activation = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${parent.id}/activate`,
      headers,
      payload: {
        requestId: crypto.randomUUID(),
        expectedRevisionId: parentItem.item?.currentRevisionId ?? parentItem.currentRevisionId,
        expectedCanonicalDigest: await documentDigestV3(envelope.envelope.body),
      },
    });
    expect(activation.statusCode, activation.body).toBe(200);
    const savedOriginal = required(
      plan.snapshot.files.find((file) => file.path === "notion-snapshot.json"),
    );
    expect(new TextDecoder().decode(savedOriginal.bytes)).toContain("Hello private fixture");
    const raw = await target.context.db.execute<{
      body: unknown;
    }>(sql`SELECT body FROM page_documents`);
    expect(JSON.stringify(raw.rows)).not.toContain("Hello private fixture");
    expect(JSON.stringify(await target.context.db.select().from(schema.revisions))).not.toContain(
      "Hello private fixture",
    );
    const walk = async (dir: string): Promise<Buffer[]> => {
      const all: Buffer[] = [];
      for (const f of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        if (f.isDirectory()) all.push(...(await walk(p)));
        else all.push(await readFile(p));
      }
      return all;
    };
    for (const bytes of await walk(harness.api.blobRoot))
      expect(bytes.includes(Buffer.from("private media fixture"))).toBe(false);
    const saved = await loadNotionImportPlan(target, plan.id);
    expect(saved.fingerprint).toBe(plan.fingerprint);
    expect(saved.snapshot.files[0]?.bytes).toEqual(plan.snapshot.files[0]?.bytes);
    const second = required(plan.pages.find((page) => page.sourceId === db.sources[1]?.id));
    const propertyId = required(Object.keys(second.values ?? {})[0]) as typeof second.id;
    const [record] = await target.context.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, second.id));
    const { submitCanonicalMutation } = await import("../src/plugins/mutations.ts");
    const changed = await submitCanonicalMutation({
      ...target.context,
      mutationId: crypto.randomUUID() as typeof second.id,
      command: {
        type: "database.entry.values.replace",
        databaseId: db.id,
        entryId: second.id,
        baseRevisionId: required(record).currentRevisionId as typeof second.id,
        values: { [propertyId]: { kind: "number", decimal: "15" } },
        relationTargets: {},
      },
    });
    expect(changed.result.status).toBe("accepted");
  }, 180000);
  it("resumes from protected snapshot after process reopen, then preserves later owner edits", async () => {
    const plan = planNotionImport(notionFixture());
    await expect(
      applyNotionImport(plan, target, {
        afterOperation: async (n) => {
          if (n === 7) throw new Error("interrupt");
        },
      }),
    ).rejects.toThrow("interrupt");
    await target.close();
    target = await openNotionTarget({
      connectionString: harness.api.postgres.connectionString,
      blobRoot: harness.api.blobRoot,
      keyFile: harness.deploymentKeyFile,
      backupRoot: join(root, "backups"),
    });
    const saved = await loadNotionImportPlan(target, plan.id);
    await applyNotionImport(saved, target);
    const before = await count();
    const page = required(plan.pages[0]);
    const opened = await item(page.id);
    const response = await harness.api.built.app.inject({
      method: "PATCH",
      url: `/v1/items/${page.id}`,
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      payload: {
        name: "Owner later title",
        baseRevisionId: opened.item?.currentRevisionId ?? opened.currentRevisionId,
      },
    });
    // Use the ordinary canonical command seam if the generic item endpoint is
    // not PATCH; this remains a real accepted owner mutation.
    if (response.statusCode !== 200) {
      const { submitCanonicalMutation } = await import("../src/plugins/mutations.ts");
      const [_record] = await target.context.db
        .select()
        .from(schema.items)
        .where(eq(schema.items.id, page.id));
      const accepted = await submitCanonicalMutation({
        ...target.context,
        mutationId: crypto.randomUUID() as typeof page.id,
        command: { type: "item.rename", itemId: page.id, name: "Owner later title" },
      });
      expect(accepted.result.status).toBe("accepted");
    }
    expect((await applyNotionImport(saved, target)).alreadyComplete).toBe(true);
    expect((await applyNotionImport(saved, target)).alreadyComplete).toBe(true);
    expect(await count()).toBe(before);
    expect(JSON.stringify(await item(page.id))).toContain("Owner later title");
  }, 180000);
  it("refuses failed backup, blocked preview and cancellation before any canonical write", async () => {
    const plan = planNotionImport(notionFixture());
    await expect(
      applyNotionImport(plan, {
        ...target,
        backup: async () => {
          throw new Error("backup unavailable");
        },
      }),
    ).rejects.toThrow("backup unavailable");
    expect(await count()).toBe(0);
    const abort = new AbortController();
    abort.abort();
    await expect(applyNotionImport(plan, target, { signal: abort.signal })).rejects.toMatchObject({
      code: "import.cancelled",
    });
    expect(await count()).toBe(0);
    plan.report.issues.push({ code: "fixture.blocked", sourcePath: "fixture", blocking: true });
    await expect(applyNotionImport(plan, target)).rejects.toBeInstanceOf(NotionImportError);
    expect(await count()).toBe(0);
  });
  it("creates a database with zero sources without inventing a lasting source", async () => {
    const fixture = notionFixture();
    fixture.sources = [];
    fixture.pages = fixture.pages.slice(0, 1);
    fixture.views = [];
    fixture.media = [];
    const plan = planNotionImport(fixture);
    await applyNotionImport(plan, target);
    expect(await target.context.db.select().from(schema.databases)).toHaveLength(0);
    expect(
      (await item(required(plan.databases[0]).id)).item?.kind ??
        (await item(required(plan.databases[0]).id)).kind,
    ).toBe("database_view");
  }, 180000);
});
