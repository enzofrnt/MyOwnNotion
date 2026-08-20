import { type DatabaseProperty, type DatabaseView, generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  GalleryView,
  galleryProperties,
  safeGalleryPreview,
} from "../src/features/databases/gallery-view.tsx";
import type { DatabaseViewPage } from "../src/services/databases.ts";

const ids = {
  database: generateUuidV7(),
  revision: generateUuidV7(),
  view: generateUuidV7(),
  title: generateUuidV7(),
  summary: generateUuidV7(),
  hidden: generateUuidV7(),
  alpha: generateUuidV7(),
  beta: generateUuidV7(),
};

const properties: readonly DatabaseProperty[] = [
  {
    id: ids.title,
    name: "Title",
    type: "title",
    positionKey: "a",
    state: "active",
    config: {},
  },
  {
    id: ids.summary,
    name: "Summary",
    type: "text",
    positionKey: "b",
    state: "active",
    config: {},
  },
  {
    id: ids.hidden,
    name: "Internal note",
    type: "text",
    positionKey: "c",
    state: "active",
    config: {},
  },
];

const view: Extract<DatabaseView, { type: "gallery" }> = {
  id: ids.view,
  name: "Project gallery",
  type: "gallery",
  positionKey: "a",
  state: "active",
  properties: properties.map((property) => ({
    propertyId: property.id,
    visible: true,
    positionKey: property.positionKey,
  })),
  filter: { mode: "all", criteria: [] },
  sorts: [],
  group: null,
  options: { cardPropertyIds: [ids.summary], preview: "page" },
};

const page: DatabaseViewPage = {
  databaseId: ids.database,
  viewId: ids.view,
  definitionRevisionId: ids.revision,
  generation: 1,
  coverage: "complete",
  availableCount: 2,
  expectedCount: 2,
  rows: [
    {
      entryId: ids.alpha,
      revisionId: generateUuidV7(),
      title: "Alpha",
      values: {
        [ids.summary]: { kind: "text", value: "Visible summary" },
        [ids.hidden]: { kind: "text", value: "Must not leak" },
      },
      relationTargets: {},
      groupId: null,
      syncState: "synced",
    },
    {
      entryId: ids.beta,
      revisionId: generateUuidV7(),
      title: "Beta",
      values: {},
      relationTargets: {},
      groupId: null,
      syncState: "pending",
    },
  ],
  groups: [],
  nextCursor: null,
  source: "local",
  staleCursorRecovered: false,
};

describe("database gallery view (T089)", () => {
  it("uses only the saved card properties", () => {
    expect(galleryProperties(view, properties).map(({ name }) => name)).toEqual(["Summary"]);
  });

  it("accepts only previews that match the saved mode and are already safe to render", () => {
    expect(safeGalleryPreview("page", { kind: "page", text: "Design brief" })).toEqual({
      kind: "page",
      text: "Design brief",
    });
    expect(
      safeGalleryPreview("first-safe-file", {
        kind: "file",
        alt: "Diagram",
        src: "https://private.example.test/diagram.svg",
      }),
    ).toBeNull();
    expect(safeGalleryPreview("none", { kind: "page", text: "Hidden" })).toBeNull();
  });

  it("renders titles, selected properties and an explicit fallback without leaking hidden values", () => {
    const markup = renderToStaticMarkup(
      createElement(GalleryView, {
        properties,
        view,
        page,
        previews: new Map([[ids.alpha, { kind: "page" as const, text: "Design brief" }]]),
        onOpenEntry: vi.fn(),
        onChangeView: vi.fn(),
      }),
    );
    expect(markup).toContain('aria-label="Project gallery gallery view"');
    expect(markup).toContain("Alpha");
    expect(markup).toContain("Beta");
    expect(markup).toContain("Design brief");
    expect(markup).toContain("No safe preview available");
    expect(markup).toContain("Visible summary");
    expect(markup).toContain('aria-posinset="2"');
    expect(markup).toContain('aria-setsize="2"');
    expect(markup).not.toContain("Must not leak");
    expect(markup).not.toContain('role="grid"');
  });
});
