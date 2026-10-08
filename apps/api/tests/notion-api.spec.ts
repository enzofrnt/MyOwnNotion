import { describe, expect, it } from "vitest";
import { NOTION_VERSION, NotionApiClient } from "../src/imports/notion/api-client.ts";
import { collectNotion } from "../src/imports/notion/collect.ts";
import { downloadNotionMedia, notionMediaUrl } from "../src/imports/notion/media.ts";
import { importId } from "../src/imports/notion/model.ts";
import { planNotionImport } from "../src/imports/notion/plan.ts";
import { notionFixture, notionIds, required, rich } from "./helpers/notion-api-fixture.ts";

const list = (results: unknown[], cursor: string | null = null) => ({
  object: "list",
  results,
  has_more: cursor !== null,
  next_cursor: cursor,
});
describe("Notion API transport and bounded collection", () => {
  it("pins version, paginates opaque cursors and obeys Retry-After without leaking remote errors", async () => {
    const calls: Array<{
        url: string;
        init?: RequestInit | undefined;
      }> = [],
      sleeps: number[] = [];
    const responses = [
      new Response("private remote error", { status: 429, headers: { "retry-after": "3" } }),
      Response.json(list([{ id: "first" }], "opaque/+cursor")),
      Response.json(list([{ id: "second" }])),
    ];
    const client = new NotionApiClient("fixture-pagination", {
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return required(responses.shift());
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(await client.discover()).toEqual([{ id: "first" }, { id: "second" }]);
    expect(sleeps).toContain(3000);
    expect(new Headers(calls[0]?.init?.headers).get("Notion-Version")).toBe(NOTION_VERSION);
    expect(JSON.parse(required(required(calls[2]).init).body as string).start_cursor).toBe(
      "opaque/+cursor",
    );
  });
  it("rejects repeated cursors, write endpoints, authentication errors and cancellation", async () => {
    const client = new NotionApiClient("fixture-repeated", {
      fetch: async () => Response.json(list([], "same")),
      sleep: async () => {},
    });
    await expect(client.discover()).rejects.toMatchObject({ code: "import.notion-invalid-cursor" });
    await expect(client.request("/pages/123", {})).rejects.toMatchObject({
      code: "import.invalid-endpoint",
    });
    const denied = new NotionApiClient("fixture-denied", {
      fetch: async () => new Response("secret remote", { status: 403 }),
      sleep: async () => {},
    });
    await expect(denied.discover()).rejects.toMatchObject({
      code: "import.notion-forbidden",
      message: "import.notion-forbidden",
    });
    const abort = new AbortController();
    abort.abort();
    await expect(
      new NotionApiClient("fixture-abort", { signal: abort.signal }).discover(),
    ).rejects.toMatchObject({ code: "import.cancelled" });
  });
  it("paginates schemas/rows/blocks/properties and detects mid-collection source edits", async () => {
    const fixture = notionFixture(),
      ids = notionIds,
      requested: string[] = [];
    const database = {
      ...fixture.databases[0],
      data_sources: [{ id: ids["sourceA"] }, { id: ids["sourceB"] }],
    };
    let drift = false;
    const mock: typeof fetch = async (input, init) => {
      const url = new URL(String(input)),
        path = url.pathname.replace("/v1", "");
      requested.push(path);
      if (path === "/search") return Response.json(list([fixture.pages[0], ...fixture.sources]));
      if (path.startsWith("/databases/")) return Response.json(database);
      if (path === "/views") return Response.json(list([]));
      for (const source of fixture.sources) {
        if (path === `/data_sources/${source["id"]}`) return Response.json(source);
        if (path === `/data_sources/${source["id"]}/query`)
          return Response.json(
            list(
              fixture.pages.filter(
                (page) =>
                  (
                    page["parent"] as {
                      data_source_id?: string;
                    }
                  ).data_source_id === source["id"],
              ),
            ),
          );
      }
      for (const page of fixture.pages) {
        if (path === `/pages/${page["id"]}`)
          return Response.json({ ...page, last_edited_time: drift ? "changed" : "stable" });
        if (path.startsWith(`/pages/${page["id"]}/properties/`)) {
          const pid = path.split("/").at(-1),
            prop = required(
              Object.values(
                page["properties"] as Record<
                  string,
                  {
                    id: string;
                    type: string;
                    [key: string]: unknown;
                  }
                >,
              ).find((p) => p.id === pid),
            );
          const body = init?.body ? JSON.parse(String(init.body)) : null;
          expect(body).toBeNull();
          return Response.json(
            list((prop[prop.type] as unknown[]).map((value) => ({ [prop.type]: value }))),
          );
        }
        if (path === `/blocks/${page["id"]}/children`)
          return Response.json(list(fixture.blocks[page["id"] as string] ?? []));
      }
      throw new Error(`unexpected fixture request ${path}`);
    };
    const client = new NotionApiClient("fixture-collection", {
      fetch: mock,
      sleep: async () => {},
    });
    const collection = await collectNotion(client, { all: true });
    expect(collection.pages).toHaveLength(3);
    expect(collection.sources).toHaveLength(2);
    expect(requested).toContain(`/pages/${ids["rowA"]}/properties/related`);
    expect(requested).not.toContain(`/pages/${ids["rowA"]}/properties/owner`);
    const plan = planNotionImport(collection);
    expect(plan.databases[0]?.sources).toHaveLength(2);
    drift = true;
    let reads = 0;
    const changing: typeof fetch = async (input, init) => {
      const response = await mock(input, init);
      if (String(input).endsWith(`/pages/${ids["parent"]}`) && ++reads === 2)
        return Response.json({ ...fixture.pages[0], last_edited_time: "different" });
      return response;
    };
    await expect(
      collectNotion(
        new NotionApiClient("fixture-drift", { fetch: changing, sleep: async () => {} }),
        { roots: [required(ids["parent"])] },
      ),
    ).rejects.toMatchObject({ code: "import.source-changed-during-read" });
  });
  it("reports inaccessible synced originals but refuses missing selected page bodies", async () => {
    const page = {
      object: "page",
      id: notionIds["parent"],
      properties: {},
      last_edited_time: "stable",
    };
    let denyBody = false;
    const mock: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/search") return Response.json(list([page]));
      if (path === `/v1/pages/${page.id}`) return Response.json(page);
      if (path === `/v1/blocks/${page.id}/children` && !denyBody)
        return Response.json(
          list([
            {
              id: notionIds["block"],
              type: "synced_block",
              has_children: true,
              synced_block: { synced_from: { block_id: notionIds["viewA"] } },
            },
          ]),
        );
      return new Response(null, { status: 404 });
    };
    const client = new NotionApiClient("fixture-unavailable-sync", {
      fetch: mock,
      sleep: async () => {},
    });
    const collected = await collectNotion(client, { all: true });
    const plan = planNotionImport(collected);
    expect(plan.report.issues.map((issue) => issue.code)).toContain(
      "import.synced-block-source-unavailable",
    );
    expect(JSON.stringify(plan.pages[0]?.document)).toContain("inaccessible");
    denyBody = true;
    await expect(collectNotion(client, { all: true })).rejects.toMatchObject({
      code: "import.notion-not-found",
    });
  });
  it("never downloads page or database covers", async () => {
    const fixture = notionFixture();
    const cover = { type: "external", external: { url: "https://fixture.invalid/cover.png" } };
    const page = {
      ...required(fixture.pages[0]),
      id: notionIds["parent"],
      cover,
      properties: {},
      last_edited_time: "stable",
    };
    const source = required(fixture.sources[0]);
    const database = { ...fixture.databases[0], cover, data_sources: [{ id: source["id"] }] };
    const mock: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/search") return Response.json(list([page, source]));
      if (path === `/v1/pages/${page["id"]}`) return Response.json(page);
      if (path === `/v1/data_sources/${source["id"]}`) return Response.json(source);
      if (path.startsWith("/v1/databases/")) return Response.json(database);
      if (path === "/v1/views" || path.endsWith("/children") || path.endsWith("/query"))
        return Response.json(list([]));
      throw new Error("Unexpected fixture path");
    };
    let downloads = 0;
    const collected = await collectNotion(
      new NotionApiClient("fixture-cover", { fetch: mock, sleep: async () => {} }),
      {
        all: true,
        download: async () => {
          downloads++;
          throw new Error("Cover requested");
        },
      },
    );
    expect(downloads).toBe(0);
    expect(collected.media).toHaveLength(0);
  });
  it("collects discovered templates even when a source query excludes them", async () => {
    const fixture = notionFixture();
    const page = {
      ...fixture.pages[1],
      id: notionIds["rowA"],
      is_template: true,
      last_edited_time: "stable",
    };
    const source = required(fixture.sources[0]);
    const database = {
      ...fixture.databases[0],
      data_sources: [{ id: source["id"] }],
      last_edited_time: "stable",
    };
    const mock: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/search") return Response.json(list([page, source]));
      if (path === `/v1/pages/${page.id}`) return Response.json(page);
      if (path === `/v1/data_sources/${source["id"]}`) return Response.json(source);
      if (path.startsWith("/v1/databases/")) return Response.json(database);
      if (
        path === "/v1/views" ||
        path.endsWith("/query") ||
        path.endsWith("/children") ||
        path.includes("/properties/")
      )
        return Response.json(list([]));
      throw new Error("Unexpected fixture path");
    };
    const collected = await collectNotion(
      new NotionApiClient("fixture-template", { fetch: mock, sleep: async () => {} }),
      { all: true },
    );
    expect(collected.pages).toHaveLength(1);
    expect(collected.issues.map((issue) => issue.code)).toContain(
      "import.database-template-as-page",
    );
  });
});
describe("native Notion conversion", () => {
  it("ignores people and historical covers while retaining recovery originals outside the item tree", () => {
    const fixture = notionFixture();
    const source = required(fixture.sources[0]);
    source["properties"] = {
      ...(source["properties"] as Record<string, unknown>),
      Creator: { id: "creator", type: "created_by" },
      Editor: { id: "editor", type: "last_edited_by" },
    };
    fixture.media.push({
      ...required(fixture.media[0]),
      key: "cover:legacy",
      base64: Buffer.from("private cover fixture").toString("base64"),
    });
    const plan = planNotionImport(fixture);
    expect(
      plan.databases[0]?.sources[0]?.definition.properties.some((p) => p.name === "Owner"),
    ).toBe(false);
    expect(plan.report.issues.map((i) => i.code)).toContain("import.property-people-ignored");
    expect(
      plan.databases
        .flatMap((database) => database.sources.flatMap((entry) => entry.definition.properties))
        .map((property) => property.name),
    ).not.toContain("Creator");
    expect(
      plan.databases
        .flatMap((database) => database.sources.flatMap((entry) => entry.definition.properties))
        .map((property) => property.name),
    ).not.toContain("Editor");
    expect(plan.files).toHaveLength(1);
    expect(plan.files.some((file) => file.original)).toBe(false);
    expect(plan.folders).toHaveLength(1);
    const original = required(
      plan.snapshot.files.find((file) => file.path === "notion-snapshot.json"),
    );
    const saved = JSON.parse(new TextDecoder().decode(original.bytes));
    expect(saved.media.some((entry: { key: string }) => entry.key.startsWith("cover:"))).toBe(
      false,
    );
    expect(saved.pages).toHaveLength(fixture.pages.length);
  });
  it("reports the native membership implication of nesting a database page inside another", () => {
    const fixture = notionFixture();
    fixture.databases.push({
      object: "database",
      id: notionIds["table"],
      title: rich("Nested"),
      parent: { type: "page_id", page_id: notionIds["database"] },
    });
    const plan = planNotionImport(fixture);
    expect(plan.databases[1]?.parentId).toBe(plan.databases[0]?.id);
    expect(plan.report.issues.map((issue) => issue.code)).toContain(
      "import.nested-database-page-membership",
    );
  });
  it("preserves multiline rich text as paragraphs and reports native inline code exclusivity", () => {
    const fixture = notionFixture();
    fixture.blocks[required(notionIds["rowB"])] = [
      {
        id: notionIds["block"],
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: "First\nSecond\r\nThird" },
              annotations: { bold: true },
            },
            { type: "text", text: { content: "Code" }, annotations: { code: true, italic: true } },
          ],
        },
      },
      { id: notionIds["table"], type: "toggle", toggle: { rich_text: rich("Title\nBody") } },
    ];
    const plan = planNotionImport(fixture);
    const blocks = required(plan.pages.find((page) => page.path === notionIds["rowB"])).document
      .body["blocks"] as unknown[];
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toMatchObject({ content: [{ text: "First", marks: [{ type: "bold" }] }] });
    expect(blocks[2]).toMatchObject({
      content: [
        { text: "Third", marks: [{ type: "bold" }] },
        { text: "Code", marks: [{ type: "code" }] },
      ],
    });
    expect(blocks[3]).toMatchObject({
      type: "toggle",
      children: [{ content: [{ text: "Body" }] }],
    });
    expect(plan.report.issues.map((issue) => issue.code)).toContain(
      "import.soft-break-as-paragraph",
    );
    expect(plan.report.issues.map((issue) => issue.code)).toContain(
      "import.inline-code-format-preserved",
    );
  });
  it("resolves modern Notion peek links and keeps linked page labels", () => {
    const fixture = notionFixture();
    fixture.blocks[required(notionIds["rowB"])] = [
      {
        id: notionIds["block"],
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: "Peek" },
              href: `https://www.notion.com/${notionIds["parent"]}?p=${notionIds["rowA"]}`,
            },
          ],
        },
      },
      {
        id: notionIds["table"],
        type: "link_to_page",
        link_to_page: { type: "page_id", page_id: notionIds["rowA"] },
      },
    ];
    const plan = planNotionImport(fixture);
    const text = JSON.stringify(plan.pages[2]?.document);
    expect(text).toContain("Same title");
    expect(text).toContain(`"targetItemId":"${plan.pages[1]?.id}"`);
  });
  it("preserves unsupported embed, table and callout details with valid native fallbacks", () => {
    const fixture = notionFixture();
    fixture.blocks[required(notionIds["rowB"])] = [
      { id: notionIds["block"], type: "bookmark", bookmark: { url: "http://example.com" } },
      { id: notionIds["table"], type: "table", table: { table_width: 51 }, import_children: [] },
      {
        id: notionIds["tableRow"],
        type: "callout",
        callout: { rich_text: rich("Flag"), icon: { type: "emoji", emoji: "🇫🇷" } },
      },
    ];
    const plan = planNotionImport(fixture);
    expect(plan.report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "import.embed-as-link",
        "import.table-preserved",
        "import.callout-icon-preserved",
      ]),
    );
    expect(JSON.stringify(plan.pages[2]?.document)).toContain('"icon":null');
  });
  it("keeps linked views on their container and never moves them into the source owner", () => {
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
    expect(plan.databases[0]?.sources).toHaveLength(0);
    expect(plan.databases[0]?.views[0]?.sourceId).toBe(plan.databases[1]?.sources[0]?.id);
    expect(plan.databases[1]?.sources[0]?.definition.views).toHaveLength(1);
    required(fixture.views[0])["quick_filters"] = { Status: { status: { equals: "Done" } } };
    const guarded = planNotionImport(fixture);
    expect(guarded.databases[1]?.views[0]?.name).toContain("table sans filtre");
  });
  it("keeps multi-source identities, typed values, rich text, tables and deferred relations", () => {
    const plan = planNotionImport(notionFixture());
    expect(plan.report.totals).toMatchObject({
      databases: 1,
      sources: 2,
      memberships: 2,
      pages: 3,
    });
    const [a, b] = plan.pages.filter((page) => page.databaseId);
    expect(a?.title).toBe(b?.title);
    expect(a?.id).not.toBe(b?.id);
    expect(a?.sourceId).not.toBe(b?.sourceId);
    expect(Object.values(a?.relationTargets ?? {})).toContainEqual([b?.id]);
    expect(Object.values(a?.values ?? {})).not.toContainEqual({
      kind: "text",
      value: "Fixture Person",
    });
    const blocks = a?.document.body["blocks"] as Array<Record<string, unknown>>;
    expect(JSON.stringify(blocks)).toContain('"type":"underline"');
    expect(blocks[1]?.["type"]).toBe("table");
    expect(plan.databases[0]?.views.map((view) => view.type)).toEqual(["board", "table"]);
    expect(plan.databases[0]?.views[1]?.filter.criteria[0]?.operator).toBe("greater-than");
  });
  it("uses separate block identities for repeated synced copies and reports unknown blocks", () => {
    const fixture = notionFixture();
    const child = {
      id: notionIds["block"],
      type: "paragraph",
      paragraph: { rich_text: rich("same synced child") },
    };
    fixture.blocks[required(notionIds["rowB"])] = [
      { id: notionIds["table"], type: "synced_block", synced_block: {}, import_children: [child] },
      {
        id: notionIds["tableRow"],
        type: "synced_block",
        synced_block: {},
        import_children: [child],
      },
    ];
    const plan = planNotionImport(fixture);
    const blocks = plan.pages[2]?.document.body["blocks"] as Array<{
      id: string;
    }>;
    expect(blocks[0]?.id).not.toBe(blocks[1]?.id);
  });
  it("deduplicates repeated media, bounds widths and visibly falls back for nested queries", () => {
    const fixture = notionFixture();
    fixture.media.push({ ...required(fixture.media[0]), key: "block:duplicate" });
    fixture.views[1] = {
      ...required(fixture.views[1]),
      configuration: { properties: [{ property_id: "amount", width: 1500.5 }] },
    };
    const plan = planNotionImport(fixture);
    expect(plan.report.totals.attachments).toBe(1);
    expect(plan.databases[0]?.views[1]?.properties[0]?.width).toBe(800);
    expect(plan.report.issues.map((issue) => issue.code)).toContain("import.view-width-adjusted");
    fixture.views[1] = {
      ...required(fixture.views[1]),
      filter: { and: [{ or: [{ property: "amount", number: { greater_than: 10 } }] }] },
    };
    const fallback = planNotionImport(fixture);
    expect(fallback.databases[0]?.views[1]?.name).toContain("table sans filtre");
    expect(fallback.report.issues.map((issue) => issue.code)).toContain(
      "import.view-query-preserved-as-fallback",
    );
  });
});
describe("Notion attachment network boundary", () => {
  it("refuses external URLs/private DNS/redirects and never sends credentials", async () => {
    expect(notionMediaUrl("http://127.0.0.1/a")).toBeNull();
    expect(notionMediaUrl("https://example.com/a")).toBeNull();
    const url = "https://prod-files-secure.s3.us-west-2.amazonaws.com/a";
    await expect(
      downloadNotionMedia(url, { resolve: async () => [{ address: "127.0.0.1" }] }),
    ).rejects.toMatchObject({ code: "import.media-host-refused" });
    const resolve = async () => [{ address: "52.1.1.1" }];
    await expect(
      downloadNotionMedia(url, {
        resolve,
        fetch: async () =>
          new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret" } }),
      }),
    ).rejects.toMatchObject({ code: "import.media-host-refused" });
    const downloaded = await downloadNotionMedia(url, {
      resolve,
      fetch: async (_url, init) => {
        expect(init?.headers).toBeUndefined();
        return new Response("media", { headers: { "content-type": "text/plain" } });
      },
    });
    expect(new TextDecoder().decode(downloaded.bytes)).toBe("media");
    await expect(
      downloadNotionMedia(url, {
        resolve,
        fetch: async () => new Response("small", { headers: { "content-length": "999999999" } }),
      }),
    ).rejects.toMatchObject({ code: "import.source-too-large" });
  });
});
