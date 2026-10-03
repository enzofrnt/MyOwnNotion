import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { pageAttachmentsByPage } from "../src/features/attachments/page-attachments.ts";

function item(kind: ProjectedItem["kind"], overrides: Partial<ProjectedItem> = {}): ProjectedItem {
  return {
    id: generateUuidV7(),
    kind,
    name: "Document",
    icon: null,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    trashedAt: null,
    purgeAfter: null,
    favourite: false,
    offlineIntent: false,
    localAvailability: "present",
    file: null,
    placements: [],
    pageDocument: null,
    ...overrides,
  };
}

function page(blocks: unknown[], formatVersion = 3): ProjectedItem {
  return item("page", {
    pageDocument: {
      format: "myownnotion.document+json",
      formatVersion,
      body: { blocks },
    },
  });
}

const embed = (file: ProjectedItem) => ({
  type: "fileEmbed",
  id: generateUuidV7(),
  fileItemId: file.id,
  caption: null,
});

describe("attachments from local page content", () => {
  it("lists embedded files and images in content order, once each, regardless of placements", () => {
    const pdf = item("file");
    const image = item("file");
    const current = page([
      {
        type: "image",
        id: generateUuidV7(),
        fileItemId: image.id,
        caption: null,
        altText: "Photo",
        displayWidth: null,
      },
      { type: "toggle", id: generateUuidV7(), content: [], children: [embed(pdf), embed(image)] },
    ]);
    const unrelated = item("file", {
      placements: [
        {
          id: generateUuidV7(),
          itemId: generateUuidV7(),
          kind: "attachment",
          parentItemId: current.id,
          parentKey: current.id,
          positionKey: "a",
        },
      ],
    });
    expect(pageAttachmentsByPage([current, unrelated, pdf, image]).get(current.id)).toEqual([
      image,
      pdf,
    ]);
  });

  it("finds files inside table cells rather than just top-level blocks", () => {
    const pdf = item("file");
    const current = page([
      {
        type: "table",
        id: generateUuidV7(),
        columns: [{ id: generateUuidV7(), width: 240 }],
        rows: [
          {
            id: generateUuidV7(),
            cells: [{ id: generateUuidV7(), content: [], children: [embed(pdf)] }],
          },
        ],
      },
    ]);
    expect(pageAttachmentsByPage([current, pdf]).get(current.id)).toEqual([pdf]);
  });

  it("removes a file from the list when its last embed is removed, keeping its storage placement intact", () => {
    const pdf = item("file");
    const current = page([embed(pdf)]);
    const stored = {
      ...pdf,
      placements: [
        {
          id: generateUuidV7(),
          itemId: pdf.id,
          kind: "attachment" as const,
          parentItemId: current.id,
          parentKey: current.id,
          positionKey: "a",
        },
      ],
    };
    expect(pageAttachmentsByPage([current, stored]).get(current.id)).toEqual([stored]);
    const emptied = { ...page([]), id: current.id };
    expect(pageAttachmentsByPage([emptied, stored]).get(current.id)).toEqual([]);
    expect(stored.placements).toHaveLength(1);
  });

  it("reads supported older documents without a storage migration", () => {
    const pdf = item("file");
    const current = page([embed(pdf)], 2);
    expect(pageAttachmentsByPage([current, pdf]).get(current.id)).toEqual([pdf]);
  });

  it("distinguishes unloaded or malformed content from a known empty page", () => {
    const unloaded = item("page");
    const unsupported = item("page", {
      pageDocument: {
        format: "myownnotion.document+json",
        formatVersion: 3,
        body: { blocks: "malformed" },
      },
    });
    const empty = page([]);
    const result = pageAttachmentsByPage([unloaded, unsupported, empty]);
    expect(result.has(unloaded.id)).toBe(false);
    expect(result.has(unsupported.id)).toBe(false);
    expect(result.get(empty.id)).toEqual([]);
  });

  it("does not list archived files, folder contents or guesses from unknown blocks", () => {
    const archived = item("file", { lifecycle: "trashed" });
    const other = item("file");
    const current = page([
      embed(archived),
      { type: "future", id: generateUuidV7(), fileItemId: other.id },
    ]);
    const folder = { ...page([embed(other)]), kind: "folder" as const };
    const result = pageAttachmentsByPage([current, archived, other, folder]);
    expect(result.get(current.id)).toEqual([]);
    expect(result.has(folder.id)).toBe(false);
  });
});
