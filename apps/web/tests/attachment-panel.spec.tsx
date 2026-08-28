import type { ItemDto } from "@myownnotion/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type AttachmentRow,
  CompactAttachmentList,
} from "../src/features/attachments/attachment-panel.tsx";

function attachment(name: string, byteLength: number): AttachmentRow {
  return {
    item: {
      id: "018f0000-0000-7000-8000-000000000001",
      name,
      file: { byteLength, mediaType: "application/pdf" },
      placements: [],
    } as unknown as ItemDto,
    addedAt: null,
    location: "Cette page",
    usages: [],
    availability: "present",
    synchronized: true,
  };
}

describe("compact attachment continuation", () => {
  it("uses one concise empty row instead of a large generic state", () => {
    const markup = renderToStaticMarkup(
      <CompactAttachmentList rows={[]} actions={() => null} onOpenUsage={() => undefined} />,
    );
    expect(markup).toContain("Aucune pièce jointe");
    expect(markup).toContain('data-testid="attachments-empty"');
    expect(markup).not.toContain("ui-async-state");
  });

  it("keeps the default line to file name and size with secondary details", () => {
    const markup = renderToStaticMarkup(
      <CompactAttachmentList
        rows={[attachment("brief.pdf", 1_024)]}
        actions={() => <button type="button">Retirer</button>}
        onOpenUsage={() => undefined}
      />,
    );
    expect(markup).toContain("brief.pdf");
    expect(markup).toContain("1.0 KiB");
    expect(markup).toContain('data-testid="attachment-brief.pdf"');
    expect(markup).toContain("Actions pour brief.pdf");
  });
});
