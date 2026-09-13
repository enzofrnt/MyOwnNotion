import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createItemViaApi } from "./helpers/app.ts";
import { createProtectedFileHarness } from "./helpers/protected-files.ts";

it("keeps a secured page's current name and retained snapshot out of readable canonical storage", async () => {
  const harness = await createProtectedFileHarness();
  const name = "canonical-private-name-sentinel";
  try {
    const page = await createItemViaApi(harness, { kind: "page", name });
    const read = await harness.owner({ method: "GET", url: `/v1/items/${page.itemId}` });
    expect(read.statusCode).toBe(200);
    expect(read.body).toContain(name);
    const raw = await harness.built.context.db.execute(sql`
      SELECT to_jsonb(i)::text AS payload FROM items i WHERE id = ${page.itemId}
      UNION ALL SELECT to_jsonb(r)::text FROM revisions r WHERE item_id = ${page.itemId}
    `);
    expect(JSON.stringify(raw.rows)).not.toContain(name);
  } finally {
    await harness.close();
  }
});

it("preserves private bodies and icons across neutral edits, rename and a no-op conversion", async () => {
  const harness = await createProtectedFileHarness();
  const itemId = generateUuidV7();
  const text = "canonical-private-body-sentinel";
  const renamed = "canonical-renamed-private-sentinel";
  const body = { blocks: [{ id: generateUuidV7(), type: "paragraph", content: [{ text }] }] };
  const mutate = (method: "POST" | "PATCH", url: string, payload: object) =>
    harness.owner({
      method,
      url,
      headers: { "idempotency-key": generateUuidV7() },
      payload,
    });
  try {
    const created = await mutate("POST", "/v1/items", {
      id: itemId,
      kind: "page",
      name: "canonical initial private title",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body },
    });
    expect(created.statusCode, created.body).toBe(201);
    for (const [method, suffix, payload] of [
      ["PATCH", "", { icon: "⭐" }],
      ["POST", "/favourite", { favourite: true }],
      ["PATCH", "", { name: renamed }],
      ["POST", "/convert", { targetKind: "page" }],
    ] as const) {
      const head = await harness.owner({ method: "GET", url: `/v1/items/${itemId}` });
      const changed = await mutate(method, `/v1/items/${itemId}${suffix}`, {
        ...payload,
        ...(method === "PATCH" ? { baseRevisionId: head.json().currentRevisionId } : {}),
      });
      expect(changed.statusCode, changed.body).toBe(200);
    }
    const read = await harness.owner({ method: "GET", url: `/v1/items/${itemId}` });
    expect(read.json()).toMatchObject({
      name: renamed,
      icon: "⭐",
      favourite: true,
      pageDocument: { body },
    });
    const revision = await harness.owner({
      method: "GET",
      url: `/v1/revisions/${read.json().currentRevisionId}`,
    });
    expect(revision.statusCode, revision.body).toBe(200);
    expect(revision.body).toContain(text);
    expect(revision.body).toContain(renamed);
    expect(revision.body).toContain("⭐");
    const raw = await harness.built.context.db.execute(sql`
      SELECT to_jsonb(i)::text AS payload FROM items i WHERE id = ${itemId}
      UNION ALL SELECT to_jsonb(r)::text FROM revisions r WHERE item_id = ${itemId}
      UNION ALL SELECT to_jsonb(p)::text FROM page_documents p WHERE page_id = ${itemId}
    `);
    for (const sentinel of [text, renamed, "⭐", "canonical initial private title"])
      expect(JSON.stringify(raw.rows)).not.toContain(sentinel);
    await harness.built.context.db.execute(
      sql`DELETE FROM protected_envelopes WHERE entity_type = 'page.body' AND entity_id = ${itemId}`,
    );
    expect((await harness.owner({ method: "GET", url: `/v1/items/${itemId}` })).statusCode).toBe(
      500,
    );
  } finally {
    await harness.close();
  }
});
