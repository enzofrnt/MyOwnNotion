import type { NotionCollection } from "../../src/imports/notion/collect.ts";
import { importId } from "../../src/imports/notion/model.ts";
export const notionIds = Object.fromEntries(
  [
    "parent",
    "database",
    "sourceA",
    "sourceB",
    "rowA",
    "rowB",
    "block",
    "table",
    "tableRow",
    "viewA",
    "viewB",
  ].map((name) => [name, importId("notion-api-fixture", name)]),
);
export const rich = (text: string) => [
  {
    type: "text",
    plain_text: text,
    text: { content: text },
    annotations: { bold: true, underline: true, color: "blue" },
  },
];
export function notionFixture(): NotionCollection {
  const ids = notionIds;
  const title = { id: "title", type: "title", title: {} };
  return {
    version: 1,
    roots: [required(ids["parent"])],
    databases: [
      {
        object: "database",
        is_inline: true,
        id: ids["database"],
        title: rich("Projects"),
        icon: { type: "emoji", emoji: "📚" },
        parent: { type: "page_id", page_id: ids["parent"] },
      },
    ],
    sources: [
      {
        object: "data_source",
        id: ids["sourceA"],
        title: rich("Tasks"),
        parent: { type: "database_id", database_id: ids["database"] },
        properties: {
          Title: title,
          Status: {
            id: "status",
            type: "status",
            status: { options: [{ id: "option", name: "Done", color: "green" }] },
          },
          Related: { id: "related", type: "relation", relation: {} },
          Owner: { id: "owner", type: "people", people: {} },
        },
      },
      {
        object: "data_source",
        id: ids["sourceB"],
        title: rich("Projects"),
        parent: { type: "database_id", database_id: ids["database"] },
        properties: { Title: title, Amount: { id: "amount", type: "number", number: {} } },
      },
    ],
    pages: [
      {
        object: "page",
        id: ids["parent"],
        parent: { type: "workspace", workspace: true },
        properties: { Title: { ...title, title: rich("Start") } },
      },
      {
        object: "page",
        id: ids["rowA"],
        icon: { type: "emoji", emoji: "🌱" },
        parent: { type: "data_source_id", data_source_id: ids["sourceA"] },
        properties: {
          Title: { ...title, title: rich("Same title") },
          Status: { id: "status", type: "status", status: { id: "option", name: "Done" } },
          Related: { id: "related", type: "relation", relation: [{ id: ids["rowB"] }] },
          Owner: {
            id: "owner",
            type: "people",
            people: [{ id: ids["parent"], name: "Fixture Person" }],
          },
        },
      },
      {
        object: "page",
        id: ids["rowB"],
        parent: { type: "data_source_id", data_source_id: ids["sourceB"] },
        properties: {
          Title: { ...title, title: rich("Same title") },
          Amount: { id: "amount", type: "number", number: 12.5 },
        },
      },
    ],
    blocks: {
      [required(ids["parent"])]: [
        { id: ids["database"], type: "child_database", child_database: { title: "Projects" } },
      ],
      [required(ids["rowA"])]: [
        {
          id: ids["block"],
          type: "paragraph",
          paragraph: {
            rich_text: [
              ...rich("Hello private fixture"),
              {
                type: "mention",
                plain_text: "Target",
                mention: { type: "page", page: { id: ids["rowB"] } },
              },
            ],
          },
        },
        {
          id: ids["table"],
          type: "table",
          table: { table_width: 1 },
          import_children: [
            { id: ids["tableRow"], type: "table_row", table_row: { cells: [rich("Cell")] } },
          ],
        },
      ],
      [required(ids["rowB"])]: [],
    },
    views: [
      {
        id: ids["viewA"],
        parent: { type: "database_id", database_id: ids["database"] },
        data_source_id: ids["sourceA"],
        name: "Board",
        type: "board",
        filter: null,
        sorts: [],
        configuration: { type: "board", group_by: { property_id: "status" } },
      },
      {
        id: ids["viewB"],
        parent: { type: "database_id", database_id: ids["database"] },
        data_source_id: ids["sourceB"],
        name: "Filtered",
        type: "table",
        filter: { property: "Amount", number: { greater_than: 10 } },
        sorts: [],
        configuration: {},
      },
    ],
    media: [
      {
        key: "property:fixture",
        ownerId: required(ids["rowA"]),
        name: "fixture.txt",
        mediaType: "text/plain",
        base64: Buffer.from("private media fixture").toString("base64"),
      },
    ],
    issues: [],
  };
}

export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Notion fixture value missing");
  return value;
}
