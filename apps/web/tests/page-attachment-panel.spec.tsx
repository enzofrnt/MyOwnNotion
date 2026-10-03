// @vitest-environment jsdom
import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentPanel } from "../src/features/attachments/attachment-panel.tsx";
import { ContentApi } from "../src/services/content-api.ts";

const pageId = generateUuidV7();
const pdf = {
  id: generateUuidV7(),
  name: "brief.pdf",
  kind: "file",
  localAvailability: "present",
  currentRevisionId: generateUuidV7(),
  file: { byteLength: 1024, mediaType: "application/pdf" },
} as ProjectedItem;

describe("the page attachment panel", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(ContentApi.prototype, "fileUsages").mockResolvedValue({
      ok: true,
      value: { usages: [] },
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("counts supplied local content without a separate upload or an item listing", async () => {
    const listing = vi.spyOn(ContentApi.prototype, "listItems");
    await act(async () =>
      root.render(<AttachmentPanel pageId={pageId} compact attachments={[pdf]} />),
    );
    expect(container.querySelector('[data-testid="attachment-brief.pdf"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="paperclip"]')).not.toBeNull();
    expect(container.querySelector(".workspace-attachment-panel__count")?.textContent).toBe("1");
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('[data-icon="plus"]')).toBeNull();
    expect(listing).not.toHaveBeenCalled();
    await act(async () =>
      root.render(<AttachmentPanel pageId={pageId} compact attachments={[]} />),
    );
    expect(container.querySelector('[data-testid="attachment-brief.pdf"]')).toBeNull();
    expect(container.querySelector('[data-testid="attachments-empty"]')?.textContent).toBe(
      "Aucune pièce jointe",
    );
    expect(container.querySelector(".workspace-attachment-panel__count")?.textContent).toBe("0");
  });

  it("does not report unloaded content as an empty page and offers to open it", async () => {
    const open = vi.fn();
    await act(async () =>
      root.render(
        <AttachmentPanel pageId={pageId} compact attachments={undefined} onOpenUsage={open} />,
      ),
    );
    expect(container.querySelector('[data-testid="attachments-empty"]')).toBeNull();
    expect(container.querySelector(".workspace-attachment-panel__count")).toBeNull();
    expect(container.textContent).toContain("Contenu non chargé");
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(open).toHaveBeenCalledWith(pageId);
    expect(ContentApi.prototype.fileUsages).not.toHaveBeenCalled();
  });

  it("mounts file actions on demand, hides them on Escape and preserves their trigger", async () => {
    await act(async () =>
      root.render(<AttachmentPanel pageId={pageId} compact attachments={[pdf]} />),
    );
    expect(document.querySelector('[data-testid="attachment-details-brief.pdf"]')).toBeNull();
    expect(document.querySelector('[data-testid="preview-file-brief.pdf"]')).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="attachment-actions-brief.pdf"]',
    );
    await act(async () => trigger?.click());
    const details = document.querySelector<HTMLElement>(
      '[data-testid="attachment-details-brief.pdf"]',
    );
    expect(details).not.toBeNull();
    expect(details?.querySelector('[data-testid="preview-file-brief.pdf"]')).not.toBeNull();
    await act(async () => {
      details?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(document.querySelector('[data-testid="attachment-details-brief.pdf"]')).toBeNull();
    expect(container.querySelector('[data-testid="attachment-actions-brief.pdf"]')).toBe(trigger);
  });

  it("retains embedded files when secondary usage information cannot be fetched", async () => {
    vi.mocked(ContentApi.prototype.fileUsages).mockResolvedValue({
      ok: false,
      problem: {
        type: "https://myownnotion.invalid/problems/unavailable",
        title: "Unavailable",
        status: 503,
      },
    });
    await act(async () =>
      root.render(<AttachmentPanel pageId={pageId} compact attachments={[pdf]} />),
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="attachment-brief.pdf"]')).not.toBeNull();
    vi.mocked(ContentApi.prototype.fileUsages).mockResolvedValue({
      ok: true,
      value: { usages: [] },
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')?.click(),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-testid="attachment-brief.pdf"]')).not.toBeNull();
  });

  it("refreshes usages when details reopen after the document adds an embedded reference", async () => {
    const lookup = vi.mocked(ContentApi.prototype.fileUsages);
    lookup.mockResolvedValueOnce({
      ok: true,
      value: { usages: [{ usedByItemId: pageId, usedByName: "Page", usageKind: "attachment" }] },
    });
    await act(async () =>
      root.render(<AttachmentPanel pageId={pageId} compact attachments={[pdf]} />),
    );
    lookup.mockResolvedValue({
      ok: true,
      value: {
        usages: [
          { usedByItemId: pageId, usedByName: "Page", usageKind: "attachment" },
          {
            usedByItemId: pageId,
            usedByName: "Page",
            usageKind: "embed",
            blockId: generateUuidV7(),
          },
        ],
      },
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="attachment-actions-brief.pdf"]',
    );
    await act(async () => trigger?.click());
    expect(lookup).toHaveBeenCalledTimes(2);
    const details = document.querySelector('[data-testid="attachment-usages-brief.pdf"]');
    expect(details?.querySelectorAll("button")).toHaveLength(2);
    expect(container.querySelector('[data-testid="attachment-brief.pdf"]')).not.toBeNull();
  });

  it("ignores a late lookup failure after the file was removed from the page", async () => {
    let fail: ((result: Awaited<ReturnType<ContentApi["fileUsages"]>>) => void) | undefined;
    vi.mocked(ContentApi.prototype.fileUsages).mockReturnValue(
      new Promise((resolve) => {
        fail = resolve;
      }),
    );
    await act(async () =>
      root.render(<AttachmentPanel pageId={pageId} compact attachments={[pdf]} />),
    );
    await act(async () =>
      root.render(<AttachmentPanel pageId={pageId} compact attachments={[]} />),
    );
    await act(async () =>
      fail?.({ ok: false, problem: { type: "unavailable", title: "Unavailable", status: 503 } }),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-testid="attachments-empty"]')).not.toBeNull();
  });
});
