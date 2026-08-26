// @vitest-environment jsdom

import { generateUuidV7 } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firstGrapheme } from "../src/features/editor/custom-blocks/callout.tsx";
import { copyCodeText } from "../src/features/editor/custom-blocks/code-block.tsx";
import {
  EMBED_IFRAME_SANDBOX,
  EmbedPreview,
  embedPreviewUrl,
} from "../src/features/editor/custom-blocks/embed.tsx";
import {
  createEditorTable,
  parseEditorTableColumns,
  serialiseEditorTableColumns,
} from "../src/features/editor/custom-blocks/table.tsx";
import { ToggleDisclosure } from "../src/features/editor/custom-blocks/toggle.tsx";
import { EditorFileTransferQueue } from "../src/features/editor/editor-files.ts";

describe("rich block behaviour", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("announces and changes the expanded state of a toggle", async () => {
    const onToggle = vi.fn();
    await act(async () => {
      root.render(<ToggleDisclosure expanded={false} onToggle={onToggle} />);
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.getAttribute("aria-label")).toBe("Déplier cette section");

    await act(async () => button?.click());
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("keeps one complete emoji grapheme for a callout icon", () => {
    expect(firstGrapheme("👨‍👩‍👧‍👦 suite")).toBe("👨‍👩‍👧‍👦");
    expect(firstGrapheme("💡💡")).toBe("💡");
    expect(firstGrapheme("   ")).toBe("");
  });

  it("copies code as plain text and reports clipboard refusal", async () => {
    const writeText = vi.fn(async () => undefined);
    await expect(copyCodeText("<script>alert(1)</script>", { writeText })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("<script>alert(1)</script>");

    await expect(
      copyCodeText("secret", {
        writeText: vi.fn(async () => {
          throw new DOMException("refused");
        }),
      }),
    ).resolves.toBe(false);
  });

  it("rejects malformed and duplicate table column identities", () => {
    const id = generateUuidV7();
    expect(parseEditorTableColumns(serialiseEditorTableColumns([{ id, width: 240 }]))).toEqual([
      { id, width: 240 },
    ]);
    expect(parseEditorTableColumns(JSON.stringify([{ id: "not-a-uuid", width: null }]))).toBeNull();
    expect(
      parseEditorTableColumns(JSON.stringify([{ id, width: null, futureWidth: 200 }])),
    ).toBeNull();
    expect(
      parseEditorTableColumns(
        JSON.stringify([
          { id, width: null },
          { id, width: 160 },
        ]),
      ),
    ).toBeNull();
  });

  it("refuses to construct a table outside the canonical bounds", () => {
    expect(() => createEditorTable(0, 3)).toThrow(RangeError);
    expect(() => createEditorTable(2, 0)).toThrow(RangeError);
    expect(() => createEditorTable(10_001, 1)).toThrow(RangeError);
    expect(() => createEditorTable(1, 51)).toThrow(RangeError);
  });

  it("does not execute an allowlisted embed until explicit consent", async () => {
    const sourceUrl = "https://www.youtube.com/watch?v=abc123";
    await act(async () => {
      root.render(<EmbedPreview provider="youtube" sourceUrl={sourceUrl} caption="Démo" />);
    });
    expect(container.querySelector("iframe")).toBeNull();

    const consent = container.querySelector<HTMLButtonElement>("button");
    await act(async () => consent?.click());
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/abc123");
    expect(iframe?.getAttribute("sandbox")).toBe(EMBED_IFRAME_SANDBOX);
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");

    await act(async () => {
      root.render(
        <EmbedPreview
          provider="youtube"
          sourceUrl="https://www.youtube.com/watch?v=changed"
          caption="Démo"
        />,
      );
    });
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("builds only provider-owned preview URLs", () => {
    expect(embedPreviewUrl("figma", "https://www.figma.com/file/abc/design")).toBe(
      "https://www.figma.com/embed?embed_host=myownnotion&url=https%3A%2F%2Fwww.figma.com%2Ffile%2Fabc%2Fdesign",
    );
    expect(embedPreviewUrl("github", "https://github.com/owner/repository")).toBeNull();
    expect(embedPreviewUrl("youtube", "https://notyoutube.test/watch?v=abc")).toBeNull();
  });

  it("distinguishes an unknown remote file from a queued local transfer", () => {
    const queue = new EditorFileTransferQueue();
    const unknownId = generateUuidV7();
    expect(queue.stateFor(unknownId)).toBeUndefined();
    expect(queue.localFileFor(unknownId)).toBeNull();

    const localId = generateUuidV7();
    const pageId = generateUuidV7();
    const file = new File(["contenu"], "note.txt", { type: "text/plain" });
    queue.enqueue(localId, file, pageId);
    expect(queue.stateFor(localId)).toEqual({ kind: "queued" });
    expect(queue.localFileFor(localId)).toBe(file);
  });
});
