// @vitest-environment jsdom
import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindWorkspaceChildCommands,
  WorkspacePageEditor,
} from "../src/features/workspace/workspace-page-editor.tsx";
import type { LocalContentService } from "../src/services/local-content.ts";

describe("the workspace editor boundary", () => {
  let root: Root;
  let container: HTMLDivElement;
  const itemId = generateUuidV7();
  const openOperationalPage = vi.fn(async () => ({
    ok: false as const,
    offline: false,
    message: "No local document",
  }));
  const getItem = vi.fn(async () => null);
  const service = { openOperationalPage, getItem } as unknown as LocalContentService;
  const items: readonly ProjectedItem[] = [];
  const child = { id: generateUuidV7(), title: "Enfant", viewId: generateUuidV7() };
  const createPage = vi.fn(async () => child);
  const createFolder = vi.fn(async () => child);
  const createDatabase = vi.fn(async () => child);
  const props = { itemId, service, items, createPage, createFolder, createDatabase };
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

  it("does not reopen the operational session during unrelated or projection updates", async () => {
    await act(async () => root.render(<WorkspacePageEditor {...props} />));
    await act(async () => root.render(<WorkspacePageEditor {...props} />));
    await act(async () =>
      root.render(<WorkspacePageEditor {...props} items={[{ id: itemId } as ProjectedItem]} />),
    );
    expect(openOperationalPage).toHaveBeenCalledExactlyOnceWith(itemId);
    expect(container.textContent).toContain("No local document");
    const nextId = generateUuidV7();
    await act(async () => root.render(<WorkspacePageEditor {...props} itemId={nextId} />));
    expect(openOperationalPage).toHaveBeenCalledTimes(2);
    expect(openOperationalPage).toHaveBeenLastCalledWith(nextId);
  });

  it("binds all child commands to the editor owner and accepts new owners and handlers", async () => {
    const request = { id: child.id, title: child.title };
    const first = bindWorkspaceChildCommands(itemId, createPage, createFolder, createDatabase);
    await first.onCreateSubpage(request);
    await first.onCreateSubfolder(request);
    await first.onCreateFullPageDatabase(request);
    await first.onCreateInlineDatabase(request);
    expect(createPage).toHaveBeenCalledExactlyOnceWith(itemId, request);
    expect(createFolder).toHaveBeenCalledExactlyOnceWith(itemId, request);
    expect(createDatabase).toHaveBeenCalledTimes(2);
    expect(createDatabase).toHaveBeenCalledWith(itemId, request);
    const nextId = generateUuidV7();
    const nextCreate = vi.fn(async () => child);
    const next = bindWorkspaceChildCommands(nextId, nextCreate, createFolder, createDatabase);
    await next.onCreateSubpage(request);
    expect(nextCreate).toHaveBeenCalledExactlyOnceWith(nextId, request);
    expect(createPage).toHaveBeenCalledTimes(1);
    expect(await next.onCreateInlineDatabase(request)).toEqual(child);
    expect(createDatabase).toHaveBeenLastCalledWith(nextId, request);
  });
});
