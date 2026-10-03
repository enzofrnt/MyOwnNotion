// @vitest-environment jsdom
import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "../src/features/editor/editor-view.tsx";
import { WorkspacePageEditor } from "../src/features/workspace/workspace-page-editor.tsx";
import type { LocalContentService } from "../src/services/local-content.ts";

const editor = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("../src/features/editor/editor-view.tsx", () => ({
  EditorView: (props: ComponentProps<typeof EditorView>) => {
    editor.render(props);
    return <div />;
  },
}));

describe("the workspace editor boundary", () => {
  let root: Root;
  let container: HTMLDivElement;
  const itemId = generateUuidV7();
  const service = {} as LocalContentService;
  const items: readonly ProjectedItem[] = [];
  const child = { id: generateUuidV7(), title: "Enfant", viewId: generateUuidV7() };
  const createPage = vi.fn(async () => child);
  const createFolder = vi.fn(async () => child);
  const createDatabase = vi.fn(async () => child);
  const props = { itemId, service, items, createPage, createFolder, createDatabase };
  const latest = () => editor.render.mock.lastCall?.[0] as ComponentProps<typeof EditorView>;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the editor untouched during unrelated parent updates, while accepting actual data changes", async () => {
    await act(async () => root.render(<WorkspacePageEditor {...props} />));
    await act(async () => root.render(<WorkspacePageEditor {...props} />));
    expect(editor.render).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(<WorkspacePageEditor {...props} items={[{ id: itemId } as ProjectedItem]} />),
    );
    expect(editor.render).toHaveBeenCalledTimes(2);
    expect(latest().items).toHaveLength(1);
  });

  it("binds all child commands to the correct parent and refreshes them when the parent or handler changes", async () => {
    await act(async () => root.render(<WorkspacePageEditor {...props} />));
    const request = { id: child.id, title: child.title };
    const first = latest();
    await first.onCreateSubpage?.(request);
    await first.onCreateSubfolder?.(request);
    await first.onCreateFullPageDatabase?.(request);
    await first.onCreateInlineDatabase?.(request);
    expect(createPage).toHaveBeenCalledWith(itemId, request);
    expect(createFolder).toHaveBeenCalledWith(itemId, request);
    expect(createDatabase).toHaveBeenCalledTimes(2);
    expect(createDatabase).toHaveBeenCalledWith(itemId, request);
    await act(async () => root.render(<WorkspacePageEditor {...props} discoverable={false} />));
    expect(latest().onCreateSubpage).toBe(first.onCreateSubpage);
    expect(latest().onCreateInlineDatabase).toBe(first.onCreateInlineDatabase);
    const nextId = generateUuidV7();
    const nextCreate = vi.fn(async () => child);
    await act(async () =>
      root.render(<WorkspacePageEditor {...props} itemId={nextId} createPage={nextCreate} />),
    );
    await latest().onCreateSubpage?.(request);
    expect(nextCreate).toHaveBeenCalledWith(nextId, request);
    expect(createPage).toHaveBeenCalledTimes(1);
  });
});
