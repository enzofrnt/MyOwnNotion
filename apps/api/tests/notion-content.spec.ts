import {
  evaluateDatabaseView,
  generateUuidV7,
  validatePageDocumentEnvelopeV3,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { convertNotionDocument } from "../src/imports/notion/blocks.ts";
import { planNotionImport } from "../src/imports/notion/plan.ts";
import { notionFixture, notionIds, required } from "./helpers/notion-api-fixture.ts";

describe("Notion native content and selection", () => {
  it.each(
    ["board", "table"].flatMap((layout) =>
      ["multi_select", "checkbox", "rich_text", "select", "status"].map((type) => ({
        layout,
        type,
        fallback: type === "rich_text" || (layout === "board" && type === "checkbox"),
      })),
    ),
  )("imports $layout grouped by $type as an executable view", ({ layout, type, fallback }) => {
    const raw = notionFixture();
    const source = required(raw.sources[0]);
    source["properties"] = {
      ...(source["properties"] as Record<string, unknown>),
      Subject: {
        id: "subject",
        type,
        [type]: { options: [{ id: "subject-option", name: "Science", color: "blue" }] },
      },
    };
    const row = required(raw.pages[1]);
    row["properties"] = {
      ...(row["properties"] as Record<string, unknown>),
      Subject: {
        id: "subject",
        type,
        [type]:
          type === "multi_select"
            ? [{ id: "subject-option", name: "Science" }]
            : type === "checkbox"
              ? true
              : type === "rich_text"
                ? [{ type: "text", plain_text: "Science", text: { content: "Science" } }]
                : { id: "subject-option", name: "Science" },
      },
    };
    const rawView = required(raw.views[0]);
    Object.assign(rawView, {
      name: "Subjects",
      type: layout,
      configuration: {
        group_by: { property_id: "subject" },
        properties: [{ property_id: "subject", visible: true }],
      },
      filter: { property: "Title", title: { contains: "Same" } },
      sorts: [{ property: "Title", direction: "descending" }],
    });
    const plan = planNotionImport(raw);
    const converted = required(required(plan.databases[0]).sources[0]);
    const view = required(converted.definition.views[0]);
    const subject = required(converted.definition.properties.find((p) => p.name === "Subject"));
    const entries = plan.pages
      .filter((page) => page.sourceId === converted.id)
      .map((page) => ({
        entryId: page.id,
        title: page.title,
        values: page.values ?? {},
        relationTargets: page.relationTargets ?? {},
      }));
    expect(view.type).toBe(fallback ? "table" : layout);
    expect(view.group).toEqual(fallback ? null : { propertyId: subject.id });
    expect(view.name).toBe(fallback ? "Subjects — table sans regroupement (import)" : "Subjects");
    expect(view.filter.criteria).toHaveLength(1);
    expect(view.sorts).toHaveLength(1);
    expect(view.properties).toHaveLength(1);
    expect(view.properties[0]).toMatchObject({ propertyId: subject.id, visible: true });
    expect(entries[0]?.values[subject.id]).toBeDefined();
    const result = evaluateDatabaseView(converted.definition, view.id, entries);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.rows.map((entry) => entry.entryId)).toEqual(
        entries.map((entry) => entry.entryId),
      );
    expect(
      plan.report.issues.some((issue) => issue.code === "import.view-grouping-preserved-as-table"),
    ).toBe(fallback);
  });

  it.each(["board", "table"])(
    "reports a missing %s grouping property without saving an invalid view",
    (type) => {
      const raw = notionFixture();
      Object.assign(required(raw.views[0]), {
        type,
        configuration: { group_by: { property_id: "unavailable-property" } },
      });
      const plan = planNotionImport(raw);
      expect(plan.databases[0]?.views[0]).toMatchObject({
        type: "table",
        group: null,
        name: "Board — table sans regroupement (import)",
      });
      expect(plan.report.issues.map((issue) => issue.code)).toContain(
        "import.view-grouping-preserved-as-table",
      );
    },
  );

  it("keeps a child database navigable when no inline view can be represented", () => {
    const source = generateUuidV7(),
      target = generateUuidV7();
    const document = validatePageDocumentEnvelopeV3(
      convertNotionDocument(
        [{ id: source, type: "child_database", child_database: { title: "Base sans vue" } }],
        {
          jobId: generateUuidV7(),
          identities: new Map([[source, target]]),
          media: new Map(),
          databaseViews: new Map(),
          issues: [],
          path: generateUuidV7(),
        },
      ),
    );
    if (!document.ok) throw Error("invalid fixture projection");
    expect(document.envelope.body.blocks?.[0]).toMatchObject({
      type: "paragraph",
      content: [{ text: "Base sans vue", marks: [{ type: "pageLink", targetItemId: target }] }],
    });
  });
  it.each([true, false, undefined])(
    "distinguishes child database presentation %s without copying its source",
    (isInline) => {
      const raw = notionFixture();
      const database = required(raw.databases[0]);
      if (isInline === undefined) delete database["is_inline"];
      else database["is_inline"] = isInline;
      raw.blocks[required(notionIds["parent"])] = [
        {
          id: required(notionIds["database"]),
          type: "child_database",
          child_database: { title: "Projects" },
        },
      ];
      const plan = planNotionImport(raw);
      const document = validatePageDocumentEnvelopeV3(required(plan.pages[0]).document);
      if (!document.ok) throw Error("invalid fixture projection");
      const owner = required(plan.databases[0]);
      if (isInline === true)
        expect(document.envelope.body.blocks?.[0]).toMatchObject({
          type: "databaseView",
          containerItemId: owner.id,
        });
      else
        expect(document.envelope.body.blocks?.[0]).toMatchObject({
          type: "paragraph",
          content: [{ text: "Projects", marks: [{ type: "pageLink", targetItemId: owner.id }] }],
        });
      expect(owner.sources).toHaveLength(2);
      expect(
        plan.report.issues.some((issue) => issue.code === "import.database-presentation-unknown"),
      ).toBe(isInline === undefined);
    },
  );

  it("resolves a database parent in nested layout blocks, retaining source memberships", () => {
    const raw = notionFixture(),
      layout = generateUuidV7(),
      column = generateUuidV7();
    required(raw.databases[0])["parent"] = { type: "block_id", block_id: column };
    raw.blocks[required(notionIds["parent"])] = [
      {
        id: layout,
        type: "column_list",
        import_children: [{ id: column, type: "column", import_children: [] }],
      },
    ];
    const plan = planNotionImport(raw);
    expect(plan.databases[0]?.parentId).toBe(plan.pages[0]?.id);
    expect(plan.pages[1]?.databaseId).toBe(plan.databases[0]?.id);
    expect(
      plan.report.issues.some((issue) => issue.code === "import.parent-outside-selection"),
    ).toBe(false);
  });
  it("excludes only an explicitly selected database, its sources, members and media", () => {
    const raw = notionFixture();
    const plan = planNotionImport(raw, undefined, {
      excludedDatabaseIds: [required(notionIds["database"])],
    });
    expect(plan.databases).toEqual([]);
    expect(plan.pages).toHaveLength(1);
    expect(plan.report.totals.sources).toBe(0);
    expect(plan.report.identities).toHaveLength(1);
    expect(plan.excludedDatabaseIds).toEqual([notionIds["database"]]);
    expect(() =>
      planNotionImport(raw, undefined, { excludedDatabaseIds: [generateUuidV7()] }),
    ).toThrow("import.excluded-database-missing");
    expect(planNotionImport(raw).databases).toHaveLength(1);
  });
  it("preserves equation source and adjacent inline identities and converts contents natively", () => {
    const raw = notionFixture(),
      source = "\\frac{a}{b}\n + c",
      pageId = required(notionIds["parent"]);
    raw.blocks[pageId] = [
      { id: generateUuidV7(), type: "equation", equation: { expression: source } },
      { id: generateUuidV7(), type: "table_of_contents", table_of_contents: { color: "default" } },
      {
        id: generateUuidV7(),
        type: "paragraph",
        paragraph: {
          rich_text: [0, 1].map(() => ({ type: "equation", equation: { expression: source } })),
        },
      },
    ];
    const paragraphInput = required(required(raw.blocks[pageId])[2]) as {
      paragraph: { rich_text: Array<Record<string, unknown>> };
    };
    required(paragraphInput.paragraph.rich_text[0])["annotations"] = { code: true, bold: true };
    const validated = validatePageDocumentEnvelopeV3(
      required(planNotionImport(raw).pages[0]).document,
    );
    if (!validated.ok) throw Error("invalid fixture projection");
    const blocks = validated.envelope.body.blocks;
    expect(blocks?.[0]).toMatchObject({ type: "equation", expression: source });
    expect(blocks?.[1]).toMatchObject({ type: "tableOfContents" });
    const paragraph = blocks?.[2];
    expect(paragraph).toMatchObject({
      type: "paragraph",
      content: [
        {
          text: source.replace(/\n/g, " "),
          marks: [{ type: "bold" }, { type: "equation", expression: source }],
        },
        { text: source.replace(/\n/g, " "), marks: [{ type: "equation", expression: source }] },
      ],
    });
    if (paragraph?.type === "paragraph")
      expect(paragraph.content[0]?.marks?.find((mark) => mark.type === "equation")).not.toEqual(
        paragraph.content[1]?.marks?.find((mark) => mark.type === "equation"),
      );
  });
});
