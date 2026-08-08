import type { ItemDto } from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttachmentPanel, selectReusableFiles } from "./attachment-panel.tsx";

const PAGE_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd7" as Uuid;

function item(
  id: string,
  name: string,
  options: { kind?: "file" | "page"; lifecycle?: "active" | "trashed"; attached?: boolean } = {},
): ItemDto {
  return {
    id,
    kind: options.kind ?? "file",
    name,
    lifecycle: options.lifecycle ?? "active",
    currentRevisionId: "019c3e8e-3140-7a75-af40-7a4b74df0dd8",
    placements: [
      {
        id: "019c3e8e-3140-7a75-af40-7a4b74df0dd9",
        itemId: id,
        kind: options.attached ? "attachment" : "hierarchy",
        parentItemId: options.attached ? PAGE_ID : null,
        positionKey: "V",
      },
    ],
  };
}

describe("existing file placement reuse", () => {
  it("filters active matching files not already attached to this page", () => {
    const reusable = selectReusableFiles(
      [
        item("019c3e8e-3140-7a75-af40-7a4b74df0de0", "Roadmap.pdf"),
        item("019c3e8e-3140-7a75-af40-7a4b74df0de1", "Roadmap old.pdf", {
          lifecycle: "trashed",
        }),
        item("019c3e8e-3140-7a75-af40-7a4b74df0de2", "Roadmap attached.pdf", {
          attached: true,
        }),
        item("019c3e8e-3140-7a75-af40-7a4b74df0de3", "Roadmap page", { kind: "page" }),
      ],
      PAGE_ID,
      "roadMAP",
    );
    expect(reusable.map((candidate) => candidate.name)).toEqual(["Roadmap.pdf"]);
  });

  it("exposes labelled import and existing-file search controls", () => {
    const html = renderToStaticMarkup(<AttachmentPanel pageId={PAGE_ID} />);
    expect(html).toContain("Import file into this page");
    expect(html).toContain("Attach an existing file");
    expect(html).toContain('type="search"');
    expect(html).toContain("No attachments");
  });
});
