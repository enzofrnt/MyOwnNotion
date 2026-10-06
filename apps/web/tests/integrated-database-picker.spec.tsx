// @vitest-environment jsdom
import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorInstance } from "../src/features/editor/blocknote-schema.ts";
import { IntegratedDatabasePicker } from "../src/features/editor/editor-menus/integrated-database-picker.tsx";
import type { LocalContentService } from "../src/services/local-content.ts";

function button(name: string): HTMLButtonElement {
  const value = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!value) throw Error(`missing button: ${name}`);
  return value;
}

describe("integrated database choice", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function fixture() {
    const blockId = generateUuidV7(),
      parentItemId = generateUuidV7(),
      ownerId = generateUuidV7(),
      sourceId = generateUuidV7();
    const items = [
      { id: ownerId, kind: "database", name: "Projet", lifecycle: "active", placements: [] },
    ] as unknown as ProjectedItem[];
    const editor = {
      getBlock: vi.fn(() => ({ id: blockId, type: "paragraph", content: [] })),
      updateBlock: vi.fn(),
      focus: vi.fn(),
    };
    const service = {
      listDatabases: vi.fn(async () => [
        { itemId: ownerId, sourceId, definition: { name: "Tâches" } },
      ]),
      getItem: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
      getDatabase: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
      mutate: vi.fn(
        async (): Promise<{ ok: boolean; error?: { title: string } }> => ({ ok: true }),
      ),
    };
    const createDatabase = vi.fn(async (request: { id: string; initialViewId?: string }) => ({
      id: request.id,
      viewId: request.initialViewId ?? "",
    }));
    const onClose = vi.fn();
    const render = async () => {
      await act(async () => {
        root.render(
          <IntegratedDatabasePicker
            blockId={blockId}
            parentItemId={parentItemId}
            items={items}
            service={service as unknown as LocalContentService}
            editor={editor as unknown as EditorInstance}
            createDatabase={createDatabase}
            onClose={onClose}
          />,
        );
      });
    };
    return {
      blockId,
      parentItemId,
      ownerId,
      sourceId,
      items,
      editor,
      service,
      createDatabase,
      onClose,
      render,
    };
  }
  it("opens without mutation and cancellation leaves no owner or block", async () => {
    const f = fixture();
    await f.render();
    expect(document.body.textContent).toContain("Base de données intégrée");
    expect(f.createDatabase).not.toHaveBeenCalled();
    expect(f.service.mutate).not.toHaveBeenCalled();
    await act(async () => button("Annuler").click());
    expect(f.onClose).toHaveBeenCalledOnce();
    expect(f.editor.updateBlock).not.toHaveBeenCalled();
  });
  it("locks double creation and inserts into the captured block", async () => {
    const f = fixture();
    await f.render();
    let resolve!: (value: { id: string; viewId: string }) => void;
    f.createDatabase.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const trigger = button("Créer une nouvelle source");
    act(() => {
      trigger.click();
      trigger.click();
    });
    expect(f.createDatabase).toHaveBeenCalledOnce();
    expect(button("Annuler").disabled).toBe(true);
    const request = f.createDatabase.mock.calls[0]?.[0];
    await act(async () => resolve({ id: f.blockId, viewId: request?.initialViewId ?? "" }));
    expect(f.editor.updateBlock).toHaveBeenCalledWith(f.blockId, {
      type: "databaseView",
      props: { containerItemId: f.blockId, viewId: request?.initialViewId },
    });
    expect(f.onClose).toHaveBeenCalledOnce();
  });
  it("retries a failed insertion using the already created source", async () => {
    const f = fixture();
    f.editor.updateBlock.mockImplementationOnce(() => {
      throw Error("Insertion interrompue");
    });
    await f.render();
    await act(async () => button("Créer une nouvelle source").click());
    expect(document.body.textContent).toContain("Insertion interrompue");
    expect(f.onClose).not.toHaveBeenCalled();
    await act(async () => button("Réessayer l’insertion").click());
    expect(f.createDatabase).toHaveBeenCalledOnce();
    expect(f.editor.updateBlock).toHaveBeenCalledTimes(2);
    expect(f.onClose).toHaveBeenCalledOnce();
  });
  it("links by source identity without copying entries, and retains identity on retry", async () => {
    const f = fixture();
    await f.render();
    await act(async () => button("Afficher une source existante").click());
    expect(document.querySelector("option")?.textContent).toBe("Projet / Tâches");
    f.service.mutate.mockResolvedValueOnce({
      ok: false,
      error: { title: "Hors ligne temporairement" },
    });
    await act(async () => button("Insérer la vue").click());
    expect(document.body.textContent).toContain("Hors ligne temporairement");
    expect(f.onClose).not.toHaveBeenCalled();
    await act(async () => button("Insérer la vue").click());
    expect(f.createDatabase).not.toHaveBeenCalled();
    expect(f.service.mutate).toHaveBeenCalledTimes(2);
    const first = f.service.mutate.mock.calls[0] as unknown as [
      string,
      { sourceId: string; id: string; initialViewId: string; placement: { parentItemId: string } },
    ];
    const second = f.service.mutate.mock.calls[1] as unknown as typeof first;
    expect(first[0]).toBe("database_view.create");
    expect(first[1]).toMatchObject({
      sourceId: f.sourceId,
      id: f.blockId,
      placement: { parentItemId: f.parentItemId },
    });
    expect(second[1].initialViewId).toBe(first[1].initialViewId);
    expect(f.onClose).toHaveBeenCalledOnce();
  });
  it("shows loading separately from empty sources and offers a failed load retry", async () => {
    const f = fixture();
    f.service.listDatabases.mockRejectedValueOnce(Error("Unavailable"));
    await f.render();
    expect(document.body.textContent).toContain("Les sources ne sont pas disponibles.");
    expect(button("Afficher une source existante").disabled).toBe(true);
    await act(async () => button("Réessayer le chargement").click());
    expect(button("Afficher une source existante").disabled).toBe(false);
    expect(f.service.mutate).not.toHaveBeenCalled();
  });
  it("keeps creation available with no existing source", async () => {
    const f = fixture();
    f.service.listDatabases.mockResolvedValueOnce([]);
    await f.render();
    expect(document.body.textContent).toContain("Aucune source existante");
    expect(button("Créer une nouvelle source").disabled).toBe(false);
    expect(button("Afficher une source existante").disabled).toBe(true);
  });

  it("shows pending source discovery before the actual empty state", async () => {
    const f = fixture();
    let resolve!: (rows: Awaited<ReturnType<typeof f.service.listDatabases>>) => void;
    f.service.listDatabases.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await f.render();
    expect(document.body.textContent).toContain("Chargement des sources…");
    expect(document.body.textContent).not.toContain("Aucune source existante");
    await act(async () => resolve([]));
    expect(document.body.textContent).toContain("Aucune source existante");
    expect(document.body.textContent).not.toContain("Chargement des sources…");
  });
  it("refuses an existing linked container whose source or parent differs", async () => {
    const f = fixture();
    f.service.getItem.mockResolvedValue({
      kind: "database_view",
      lifecycle: "active",
      placements: [{ kind: "hierarchy", parentItemId: f.parentItemId }],
    });
    f.service.getDatabase.mockResolvedValue({
      presentation: { views: [{ id: generateUuidV7(), sourceId: generateUuidV7() }] },
    });
    await f.render();
    await act(async () => button("Afficher une source existante").click());
    await act(async () => button("Insérer la vue").click());
    expect(document.body.textContent).toContain("Ce bloc appartient déjà");
    expect(f.service.mutate).not.toHaveBeenCalled();
    expect(f.editor.updateBlock).not.toHaveBeenCalled();
  });
  it("does not overwrite a concurrently changed insertion location", async () => {
    const f = fixture();
    await f.render();
    f.editor.getBlock.mockReturnValue({
      id: f.blockId,
      type: "paragraph",
      content: ["Édition distante"],
    } as never);
    await act(async () => button("Créer une nouvelle source").click());
    expect(document.body.textContent).toContain("L’emplacement d’insertion n’est plus disponible.");
    expect(f.createDatabase).not.toHaveBeenCalled();
  });
});
