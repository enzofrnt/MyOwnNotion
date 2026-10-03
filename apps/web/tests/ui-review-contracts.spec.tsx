// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyEditor } from "../src/features/databases/property-editor.tsx";
import { FilePreviewSurface } from "../src/features/files/file-preview.tsx";
import { DesktopUpdateSurface } from "../src/features/update/desktop-update-panel.tsx";
import { NativeInput, NativeSelect, ReadTable } from "../src/ui/primitives/index.ts";
import { createReviewEditorSession } from "../src/ui/ui-lab-review-editor-session.ts";
import { reviewId } from "../src/ui/ui-lab-review-fixtures.ts";

describe("shared compositions preserve native and domain contracts", () => {
  let node: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    node = document.createElement("div");
    document.body.append(node);
    root = createRoot(node);
  });
  afterEach(() => {
    act(() => root.unmount());
    node.remove();
    vi.restoreAllMocks();
  });

  it("keeps uncontrolled inputs, multiple selection, native size and form submission", async () => {
    await act(async () =>
      root.render(
        <form>
          <NativeInput name="title" defaultValue="Brouillon" />
          <NativeSelect name="tags" multiple size={6} defaultValue={["a", "c"]}>
            <option value="a">A</option>
            <option value="b">B</option>
            <option value="c">C</option>
          </NativeSelect>
        </form>,
      ),
    );
    const field = node.querySelector("input");
    const select = node.querySelector("select");
    expect(field?.value).toBe("Brouillon");
    expect(select?.size).toBe(6);
    const form = node.querySelector("form");
    if (!field || !form || !select) throw new Error("Missing native controls");
    field.value = "Titre final";
    const second = select.options[1];
    if (second === undefined) throw new Error("Missing option");
    second.selected = true;
    const values = new FormData(form);
    expect(values.get("title")).toBe("Titre final");
    expect(values.getAll("tags")).toEqual(["a", "b", "c"]);
  });

  it.each(["multi-select", "status"] as const)(
    "retains an existing %s property when saved without a type change",
    async (type) => {
      const submit = vi.fn();
      await act(async () =>
        root.render(
          <PropertyEditor
            draft={{
              name: "Catégories",
              type,
              options: [{ key: "a", label: "Conservée", tone: "purple" }],
            }}
            error={null}
            onChange={() => undefined}
            onSubmit={submit}
            onCancel={() => undefined}
          />,
        ),
      );
      expect(node.querySelector<HTMLSelectElement>('[name="property-type"]')?.value).toBe(type);
      await act(async () =>
        node
          .querySelector("form")
          ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Catégories",
          type,
          options: [{ key: "a", label: "Conservée", tone: "purple" }],
        }),
      );
    },
  );

  it("keeps an opaque sandbox and download fallback without fetching in the presentation", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const props = {
      fileItemId: "file-1",
      fileName: "Document.svg",
      mediaType: "image/svg+xml",
      byteLength: 32,
    };
    await act(async () =>
      root.render(<FilePreviewSurface {...props} load={{ kind: "ready", url: "blob:example" }} />),
    );
    const frame = node.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    await act(async () =>
      root.render(
        <FilePreviewSurface {...props} load={{ kind: "failed", reason: "Conservé localement" }} />,
      ),
    );
    expect(node.querySelector("a")?.getAttribute("href")).toBe("/v1/files/file-1/content");
    expect(node.querySelector("a")?.getAttribute("download")).toBe("Document.svg");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks installation while local changes or migration are pending", async () => {
    const install = vi.fn();
    for (const guard of [
      { pendingLocalChanges: true, migrationActive: false },
      { pendingLocalChanges: false, migrationActive: true },
      { pendingLocalChanges: false, migrationActive: false },
    ]) {
      await act(async () =>
        root.render(
          <DesktopUpdateSurface
            state={{ phase: "available", version: "0.1.0", message: null, ...guard }}
            busy={false}
            error={false}
            onCheck={() => undefined}
            onDefer={() => undefined}
            onInstall={install}
          />,
        ),
      );
      const button = [...node.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Installer"),
      );
      expect(button?.disabled).toBe(guard.pendingLocalChanges || guard.migrationActive);
      await act(async () => button?.click());
    }
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("keeps table caption and cells readable in a named keyboard scroll region", async () => {
    await act(async () =>
      root.render(
        <ReadTable scrollLabel="Comparer les versions">
          <caption>Contenu conservé</caption>
          <tbody>
            <tr>
              <th scope="row">Titre</th>
              <td>Ancien</td>
              <td>Nouveau</td>
            </tr>
          </tbody>
        </ReadTable>,
      ),
    );
    expect(node.querySelector("section")?.getAttribute("aria-label")).toBe("Comparer les versions");
    expect(node.querySelector("section")?.getAttribute("tabindex")).toBe("0");
    expect(node.querySelector("caption")?.textContent).toBe("Contenu conservé");
    expect(node.querySelectorAll("td")).toHaveLength(2);
  });

  it("keeps rich V3 content and live undo state in the isolated editor", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const document = {
      blocks: [
        {
          id: reviewId(74),
          type: "callout" as const,
          content: [{ text: "Contenu conservé" }],
          icon: "💡",
          tone: "blue" as const,
        },
      ],
    };
    const session = createReviewEditorSession(document);
    expect(session.read()).toEqual(document);
    expect(session.canUndo).toBe(false);
    await session.transact({ type: "delete-block", blockId: reviewId(74) });
    expect(session.read().blocks).toHaveLength(0);
    expect(session.canUndo).toBe(true);
    await session.undo();
    expect(session.read()).toEqual(document);
    expect(session.canRedo).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
