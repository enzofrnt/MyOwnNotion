// @vitest-environment jsdom

import type {
  LocalDatabaseEntryRow,
  LocalDatabaseRow,
  ProjectedItem,
} from "@myownnotion/client-core";
import {
  createInitialDatabaseDefinition,
  DATABASE_PRESENTATION_FORMAT,
  generateUuidV7,
  ownedSourceIdFromItemId,
  type Uuid,
} from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseContainerPage } from "../src/features/databases/database-container-page.tsx";
import {
  DatabaseViewSurface,
  loadView,
} from "../src/features/editor/custom-blocks/database-view.tsx";
import type { LocalContentService, LocalContentSnapshot } from "../src/services/local-content.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function advance() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function item(id: Uuid, name: string, kind: "page" | "folder" = "page"): ProjectedItem {
  return {
    id,
    kind,
    name,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    pageDocument: null,
    placements: [],
  } as unknown as ProjectedItem;
}

function fixture({ legacy = false, linked = false, secondary = false, complete = true } = {}) {
  const containerId = generateUuidV7();
  const ownerId = linked ? generateUuidV7() : containerId;
  const primarySourceId = legacy ? ownedSourceIdFromItemId(ownerId) : generateUuidV7();
  const sourceId = secondary ? generateUuidV7() : primarySourceId;
  const viewId = generateUuidV7();
  const titlePropertyId = generateUuidV7();
  const definition = createInitialDatabaseDefinition({
    type: "database.create",
    id: ownerId,
    name: "Source locale",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId,
    initialViewId: viewId,
    initialViewName: "Vue actuelle",
  });
  const source: LocalDatabaseRow = {
    itemId: ownerId,
    ...(legacy ? {} : { sourceId }),
    definitionVersion: 1,
    definitionRevisionId: generateUuidV7(),
    definition,
  };
  const ownerContainer: LocalDatabaseRow = { ...source, sourceId: primarySourceId };
  const container: LocalDatabaseRow = {
    ...(linked ? { ...source, itemId: containerId } : ownerContainer),
    presentationVersion: 1,
    presentationRevisionId: generateUuidV7(),
    presentation: {
      format: DATABASE_PRESENTATION_FORMAT,
      formatVersion: 1,
      containerItemId: containerId,
      views: definition.views.map((view) => ({ ...view, sourceId })),
    },
  };
  const entryId = generateUuidV7();
  const row: LocalDatabaseEntryRow = {
    entryItemId: entryId,
    databaseId: ownerId,
    sourceId,
    valueVersion: 1,
    availability: "present",
    values: {
      format: "myownnotion.database-entry-values+json",
      formatVersion: 1,
      databaseId: ownerId,
      values: {},
    },
  };
  const listeners = new Set<() => void>();
  const snapshotListeners = new Set<() => void>();
  let snapshot: LocalContentSnapshot = {
    syncState: "synced",
    pendingCount: 0,
    filePendingCount: 0,
    conflictCount: 0,
    attentionCount: 0,
    recoveryPendingCount: 0,
    quarantinedRecoveryCount: 0,
    storagePersisted: null,
    projectionComplete: complete,
    projectionLoadFailed: false,
  };
  const mocks = {
    subscribe: vi.fn((listener: () => void) => {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    }),
    getSnapshot: vi.fn(() => snapshot),
    synchronize: vi.fn(async () => snapshot.syncState),
    mutate: vi.fn(async () => ({ ok: true })),
    replaceDatabaseDefinition: vi.fn(async () => ({ ok: true })),
    getDatabase: vi.fn(async (id: Uuid) => {
      if (id === containerId) return container;
      if (id === ownerId) return ownerContainer;
      if (!legacy && id === sourceId) return source;
      return null;
    }),
    listDatabases: vi.fn(async () => [source]),
    getItem: vi.fn(async (id: Uuid) => ({ id, lifecycle: "active", kind: "database" })),
    listDatabaseEntries: vi.fn(async () => [row]),
    getItems: vi.fn(async () => [item(entryId, "Élément actuel")]),
    getDatabaseEntryRelations: vi.fn(async () => new Map()),
    subscribeProjection: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    outbox: { all: vi.fn(async () => []), activeConflicts: vi.fn(async () => []) },
  };
  return {
    containerId,
    ownerId,
    primarySourceId,
    sourceId,
    viewId,
    entryId,
    source,
    container,
    row,
    mocks,
    listeners,
    setSnapshot: (next: Partial<LocalContentSnapshot>) => {
      snapshot = { ...snapshot, ...next };
      for (const listener of snapshotListeners) listener();
    },
    emit: () => {
      for (const listener of listeners) listener();
    },
    service: mocks as unknown as LocalContentService,
  };
}

describe("database view source loading", () => {
  it("looks up the source directly and reuses its own container", async () => {
    const f = fixture();
    const loaded = await loadView(f.service, f.containerId, f.viewId);
    expect(loaded).toMatchObject({ source: f.source, entries: [{ title: "Élément actuel" }] });
    expect(f.mocks.getDatabase.mock.calls.map(([id]) => id)).toEqual([f.containerId, f.sourceId]);
    expect(f.mocks.listDatabases).not.toHaveBeenCalled();
  });

  it("retains the inventory fallback for an implicit legacy primary source", async () => {
    const f = fixture({ legacy: true });
    expect(await loadView(f.service, f.containerId, f.viewId)).toMatchObject({ source: f.source });
    expect(f.mocks.listDatabases).toHaveBeenCalledTimes(1);
    expect(f.mocks.getDatabase.mock.calls.map(([id]) => id)).toEqual([f.containerId, f.sourceId]);
  });

  it("hydrates a linked secondary source without mixing implicit primary memberships", async () => {
    const f = fixture({ linked: true, secondary: true });
    const primaryEntryId = generateUuidV7();
    const offloadedId = generateUuidV7();
    f.mocks.listDatabaseEntries.mockResolvedValue([
      { ...f.row, entryItemId: primaryEntryId, sourceId: undefined },
      f.row,
      { ...f.row, entryItemId: offloadedId, availability: "offloaded" },
    ]);
    f.mocks.getItems.mockResolvedValue([
      item(offloadedId, "Conservé sans valeurs", "folder"),
      item(f.entryId, "Source secondaire"),
      item(primaryEntryId, "Source primaire"),
    ]);
    const relationPropertyId = generateUuidV7();
    f.mocks.getDatabaseEntryRelations.mockResolvedValue(
      new Map([[f.entryId, { [relationPropertyId]: [primaryEntryId] }]]),
    );
    f.mocks.outbox.all.mockResolvedValue([{ payload: { entryId: f.entryId } }] as never[]);
    f.mocks.outbox.activeConflicts.mockResolvedValue([
      { payload: { itemId: f.entryId } },
    ] as never[]);
    const loaded = await loadView(f.service, f.containerId, f.viewId);
    if (typeof loaded === "string") throw new Error(loaded);
    expect(f.mocks.listDatabases).not.toHaveBeenCalled();
    expect(f.mocks.getDatabase.mock.calls.map(([id]) => id)).toEqual([
      f.containerId,
      f.sourceId,
      f.ownerId,
    ]);
    expect(f.mocks.getItems).toHaveBeenCalledExactlyOnceWith([f.entryId, offloadedId]);
    expect(loaded.entries.map((entry) => entry.entryId)).toEqual([f.entryId, offloadedId]);
    expect(loaded.entries[0]?.relationTargets).toEqual({ [relationPropertyId]: [primaryEntryId] });
    expect(loaded.querySource).toMatchObject({
      databaseId: f.ownerId,
      expectedCount: 2,
      entries: [{ availability: "present" }, { availability: "offloaded", values: {} }],
    });
    expect(loaded.states.get(f.entryId)).toBe("conflict");
  });

  it("keeps absent item metadata in expected coverage without inventing an entry", async () => {
    const f = fixture();
    f.mocks.getItems.mockResolvedValue([]);
    expect(await loadView(f.service, f.containerId, f.viewId)).toMatchObject({
      entries: [],
      querySource: { expectedCount: 1, entries: [] },
    });
  });

  it("starts independent owner, membership and diagnostic reads together", async () => {
    const f = fixture({ linked: true });
    const owner = deferred<LocalDatabaseRow | null>();
    const memberships = deferred<LocalDatabaseEntryRow[]>();
    const queued = deferred<never[]>();
    const conflicts = deferred<never[]>();
    const items = deferred<ProjectedItem[]>();
    f.mocks.getDatabase.mockImplementation(async (id) => {
      if (id === f.containerId) return f.container;
      if (id === f.sourceId) return f.source;
      return owner.promise;
    });
    f.mocks.listDatabaseEntries.mockReturnValueOnce(memberships.promise);
    f.mocks.outbox.all.mockReturnValueOnce(queued.promise);
    f.mocks.outbox.activeConflicts.mockReturnValueOnce(conflicts.promise);
    f.mocks.getItems.mockReturnValueOnce(items.promise);
    const completion = loadView(f.service, f.containerId, f.viewId);
    await advance();
    expect(f.mocks.getDatabase).toHaveBeenCalledWith(f.ownerId);
    expect(f.mocks.listDatabaseEntries).toHaveBeenCalledExactlyOnceWith(f.ownerId);
    expect(f.mocks.outbox.all).toHaveBeenCalledTimes(1);
    expect(f.mocks.outbox.activeConflicts).toHaveBeenCalledTimes(1);
    expect(f.mocks.getItems).not.toHaveBeenCalled();
    owner.resolve(f.source);
    memberships.resolve([f.row]);
    queued.resolve([]);
    conflicts.resolve([]);
    await advance();
    expect(f.mocks.getItems).toHaveBeenCalledExactlyOnceWith([f.entryId]);
    expect(f.mocks.getDatabaseEntryRelations).toHaveBeenCalledExactlyOnceWith(f.ownerId, [
      f.entryId,
    ]);
    items.resolve([item(f.entryId, "Lecture parallèle")]);
    expect(await completion).toMatchObject({ entries: [{ title: "Lecture parallèle" }] });
  });

  it("reports a missing view before reading a source", async () => {
    const f = fixture();
    expect(await loadView(f.service, f.containerId, generateUuidV7())).toBe("missing-view");
    expect(f.mocks.getDatabase).toHaveBeenCalledExactlyOnceWith(f.containerId);
    expect(f.mocks.listDatabases).not.toHaveBeenCalled();
  });

  it("reports a missing source after a null direct lookup and empty legacy fallback", async () => {
    const f = fixture();
    f.mocks.getDatabase.mockImplementation(async (id) =>
      id === f.containerId ? f.container : null,
    );
    f.mocks.listDatabases.mockResolvedValue([]);
    expect(await loadView(f.service, f.containerId, f.viewId)).toBe("missing-source");
    expect(f.mocks.listDatabases).toHaveBeenCalledTimes(1);
    expect(f.mocks.listDatabaseEntries).not.toHaveBeenCalled();
  });

  it("does not replace an unreadable source with an inventory fallback", async () => {
    const f = fixture();
    const failure = new Error("source cannot be decrypted");
    f.mocks.getDatabase.mockImplementation(async (id) => {
      if (id === f.containerId) return f.container;
      throw failure;
    });
    await expect(loadView(f.service, f.containerId, f.viewId)).rejects.toBe(failure);
    expect(f.mocks.listDatabases).not.toHaveBeenCalled();
  });

  it.each(["trashed", "purged"] as const)(
    "preserves a %s owner's source state without reading its memberships",
    async (lifecycle) => {
      const f = fixture();
      f.mocks.getItem.mockResolvedValue({ id: f.ownerId, lifecycle, kind: "database" });
      expect(await loadView(f.service, f.containerId, f.viewId)).toMatchObject({
        sourceLifecycle: lifecycle,
        entries: [],
        querySource: { expectedCount: 0 },
      });
      expect(f.mocks.listDatabaseEntries).not.toHaveBeenCalled();
    },
  );

  it("does not hydrate memberships when the source owner is missing", async () => {
    const f = fixture();
    f.mocks.getItem.mockResolvedValue(null as never);
    expect(await loadView(f.service, f.containerId, f.viewId)).toBe("missing-source");
    expect(f.mocks.listDatabaseEntries).not.toHaveBeenCalled();
  });
});

describe("database projection subscribers", () => {
  let element: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);
  });

  afterEach(() => {
    act(() => root.unmount());
    element.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps an embedded source without known memberships in discovery until its late rows arrive", async () => {
    const f = fixture({ complete: false });
    f.mocks.listDatabaseEntries.mockResolvedValue([]);
    f.mocks.getItems.mockResolvedValue([]);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseViewSurface
            containerItemId={f.containerId}
            viewId={f.viewId}
            service={f.service}
            openItem={vi.fn()}
          />
        </MemoryRouter>,
      );
      for (let index = 0; index < 100; index += 1) f.emit();
      await advance();
    });
    expect(element.querySelector('[data-kind="loading"]')).not.toBeNull();
    expect(element.querySelector(".database-table")).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(f.mocks.listDatabaseEntries).toHaveBeenCalledTimes(1);
    await act(async () => {
      f.mocks.listDatabaseEntries.mockResolvedValue([f.row]);
      f.mocks.getItems.mockResolvedValue([item(f.entryId, "Élément reçu dans le dernier lot")]);
      f.setSnapshot({ projectionComplete: true });
      await advance();
    });
    expect(element.textContent).toContain("Élément reçu dans le dernier lot");
    expect(f.mocks.listDatabaseEntries).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["offline", { syncState: "offline" }, "pas encore disponible"],
    ["error", { projectionLoadFailed: true }, "n’a pas pu être chargée"],
  ] as const)(
    "shows a retryable %s state for an undiscovered embedded source",
    async (kind, state, message) => {
      const f = fixture({ complete: false });
      f.mocks.listDatabaseEntries.mockResolvedValue([]);
      f.mocks.getItems.mockResolvedValue([]);
      f.setSnapshot(state);
      await act(async () => {
        root.render(
          <MemoryRouter>
            <DatabaseViewSurface
              containerItemId={f.containerId}
              viewId={f.viewId}
              service={f.service}
              openItem={vi.fn()}
            />
          </MemoryRouter>,
        );
        await advance();
      });
      expect(element.querySelector(`[data-kind="${kind}"]`)?.textContent).toContain(message);
      const retry = Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.includes("Réessayer"),
      );
      if (retry === undefined) throw new Error("Missing retry action");
      await act(async () => {
        retry.click();
        await advance();
      });
      expect(f.mocks.synchronize).toHaveBeenCalledTimes(1);
      expect(element.querySelector(".database-table")).toBeNull();
      await act(async () => {
        f.setSnapshot({ syncState: "syncing", projectionLoadFailed: false });
        await advance();
      });
      expect(element.querySelector('[data-kind="loading"]')).not.toBeNull();
      expect(element.textContent).not.toContain("Réessayer");
      await act(async () => {
        f.mocks.listDatabaseEntries.mockResolvedValue([f.row]);
        f.mocks.getItems.mockResolvedValue([item(f.entryId, "Élément actuel")]);
        f.setSnapshot({ projectionComplete: true, syncState: "synced" });
        await advance();
      });
      expect(element.textContent).toContain("Élément actuel");
    },
  );

  it("permits a truly empty embedded database only after discovery is complete", async () => {
    const f = fixture({ complete: false });
    f.mocks.listDatabaseEntries.mockResolvedValue([]);
    f.mocks.getItems.mockResolvedValue([]);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseViewSurface
            containerItemId={f.containerId}
            viewId={f.viewId}
            service={f.service}
            openItem={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    expect(element.querySelector(".database-table")).toBeNull();
    await act(async () => {
      f.setSnapshot({ projectionComplete: true });
      await advance();
    });
    expect(element.querySelector(".database-table")).not.toBeNull();
    expect(element.querySelector('[data-kind="loading"]')).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it("requires a new accepted snapshot after discovery becomes incomplete again", async () => {
    const f = fixture();
    const pending = deferred<ProjectedItem[]>();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseViewSurface
            containerItemId={f.containerId}
            viewId={f.viewId}
            service={f.service}
            openItem={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    expect(element.textContent).toContain("Élément actuel");
    await act(async () => {
      f.setSnapshot({ projectionComplete: false });
      await advance();
    });
    expect(element.textContent).toContain("Élément actuel");
    expect(element.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("-1");
    f.mocks.getItems.mockReturnValueOnce(pending.promise);
    await act(async () => {
      f.setSnapshot({ projectionComplete: true });
      await advance();
    });
    expect(element.textContent).toContain("Élément actuel");
    expect(element.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("-1");
    await act(async () => {
      pending.resolve([item(f.entryId, "Projection redécouverte")]);
      await advance();
    });
    expect(element.textContent).toContain("Projection redécouverte");
    expect(element.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("2");
  });

  it("keeps legacy cached entries readable offline without inventing complete discovery", async () => {
    const f = fixture({ complete: false, legacy: true });
    f.setSnapshot({ syncState: "offline" });
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseViewSurface
            containerItemId={f.containerId}
            viewId={f.viewId}
            service={f.service}
            openItem={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    expect(element.textContent).toContain("Élément actuel");
    expect(element.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("-1");
    const notice = element.querySelector('[data-testid="database-discovery-state"]');
    expect(notice?.getAttribute("data-state")).toBe("offline");
    expect(notice?.textContent).toContain("Données locales disponibles");
    expect(element.textContent).not.toContain("1 sur 1");
    const retry = notice?.querySelector<HTMLButtonElement>("button");
    if (retry === null || retry === undefined) throw new Error("Missing discovery retry");
    await act(async () => {
      retry.click();
      await advance();
    });
    expect(f.mocks.synchronize).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain("Élément actuel");
  });

  it("subscribes to partial batches and retains known rows during delayed or failed refreshes", async () => {
    const f = fixture({ complete: false });
    const pending = deferred<ProjectedItem[]>();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseViewSurface
            containerItemId={f.containerId}
            viewId={f.viewId}
            service={f.service}
            openItem={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    const trigger = element.querySelector("[data-entry-trigger]");
    f.mocks.getItems.mockReturnValueOnce(pending.promise);
    await act(async () => {
      f.emit();
      await advance();
    });
    expect(element.querySelector("[data-entry-trigger]")).toBe(trigger);
    expect(element.textContent).toContain("Élément actuel");
    await act(async () => {
      pending.resolve([item(f.entryId, "Entrée locale actualisée")]);
      await advance();
    });
    expect(element.textContent).toContain("Entrée locale actualisée");
    f.mocks.getItems.mockRejectedValueOnce(new Error("temporary local read failure"));
    await act(async () => {
      f.emit();
      await advance();
    });
    expect(element.textContent).toContain("Entrée locale actualisée");
    expect(element.querySelector('[role="alert"]')?.textContent).toContain("actualisées");
    expect(element.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("-1");
  });

  it("retains a fully discovered canvas with a retryable error when its refresh fails", async () => {
    const f = fixture();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseViewSurface
            containerItemId={f.containerId}
            viewId={f.viewId}
            service={f.service}
            openItem={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    const trigger = element.querySelector("[data-entry-trigger]");
    f.mocks.getItems.mockRejectedValueOnce(new Error("failed local refresh"));
    await act(async () => {
      f.emit();
      await advance();
    });
    expect(element.querySelector("[data-entry-trigger]")).toBe(trigger);
    expect(element.textContent).toContain("Élément actuel");
    const notice = element.querySelector('[data-testid="database-discovery-state"]');
    expect(notice?.getAttribute("data-state")).toBe("error");
    const retry = notice?.querySelector<HTMLButtonElement>("button");
    if (retry === null || retry === undefined) throw new Error("Missing local refresh retry");
    await act(async () => {
      retry.click();
      await advance();
    });
    expect(f.mocks.synchronize).toHaveBeenCalledTimes(1);
    expect(element.querySelector("[data-entry-trigger]")).toBe(trigger);
    expect(element.querySelector('[data-testid="database-discovery-state"]')).toBeNull();
    expect(element.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("2");
  });

  it("refuses a structure preview from partial memberships while allowing a view change", async () => {
    const f = fixture({ complete: false });
    const propertyId = generateUuidV7();
    const source: LocalDatabaseRow = {
      ...f.source,
      definition: {
        ...f.source.definition,
        properties: [
          ...f.source.definition.properties,
          {
            id: propertyId,
            name: "Details",
            type: "text",
            state: "active",
            positionKey: "b",
            config: {},
          },
        ],
      },
    };
    f.mocks.getDatabase.mockImplementation(async (id) => {
      if (id === f.containerId) return { ...f.container, definition: source.definition };
      if (id === f.sourceId) return source;
      return null;
    });
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseViewSurface
            containerItemId={f.containerId}
            viewId={f.viewId}
            service={f.service}
            openItem={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    await act(async () => {
      element
        .querySelector<HTMLButtonElement>('[aria-label="Filtrer, trier et configurer"]')
        ?.click();
      await advance();
    });
    const property = Array.from(document.querySelectorAll(".database-schema__property")).find(
      (candidate) => candidate.textContent?.includes("Details"),
    );
    const remove = Array.from(property?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (button) => button.textContent?.includes("Supprimer"),
    );
    if (remove === undefined) throw new Error("Missing property retirement action");
    await act(async () => {
      remove.click();
      await advance();
    });
    expect(element.textContent).toContain("Attendez la fin du chargement des entrées");
    expect(element.querySelector('[role="alertdialog"]')).toBeNull();
    expect(f.mocks.replaceDatabaseDefinition).not.toHaveBeenCalled();
    expect(f.mocks.mutate).not.toHaveBeenCalled();
    expect(f.mocks.listDatabaseEntries).toHaveBeenCalledTimes(1);
    // Width changes affect the view's presentation only, so they remain safe locally.
    const resize = element.querySelector<HTMLElement>('[data-testid="database-column-resize"]');
    if (resize === null) throw new Error("Missing view resize handle");
    await act(async () => {
      resize.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await advance();
    });
    expect(f.mocks.mutate).toHaveBeenCalledTimes(1);
    expect(f.mocks.replaceDatabaseDefinition).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Élément actuel");
  });

  it("publishes only the final native container snapshot after notifications during load", async () => {
    const f = fixture();
    const obsolete = deferred<LocalDatabaseRow | null>();
    const latest = deferred<LocalDatabaseRow | null>();
    const presentation = f.container.presentation;
    if (presentation === undefined) throw new Error("Missing presentation");
    const newContainer: LocalDatabaseRow = {
      ...f.container,
      presentation: {
        ...presentation,
        views: presentation.views.map((view) => ({ ...view, name: "Vue récente" })),
      },
    };
    let containerReads = 0;
    f.mocks.getDatabase.mockImplementation(async (id) => {
      if (id !== f.containerId) return id === f.sourceId ? f.source : null;
      containerReads += 1;
      if (containerReads === 1) return obsolete.promise;
      if (containerReads === 2) return latest.promise;
      return newContainer;
    });
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseContainerPage
            containerItemId={f.containerId}
            service={f.service}
            onOpenEntry={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    expect(containerReads).toBe(1);
    await act(async () => {
      f.emit();
      f.emit();
      obsolete.resolve(f.container);
      await advance();
    });
    expect(element.textContent).not.toContain("Vue actuelle");
    expect(containerReads).toBe(2);
    expect(f.mocks.listDatabases).toHaveBeenCalledTimes(2);
    await act(async () => {
      latest.resolve(newContainer);
      await advance();
    });
    expect(element.querySelector(".database-container-page__tabs")?.textContent).toContain(
      "Vue récente",
    );
    expect(element.textContent).toContain("Élément actuel");
  });

  it("refreshes an embedded surface after every notification and discards stale rows", async () => {
    const f = fixture();
    const obsolete = deferred<ProjectedItem[]>();
    const latest = deferred<ProjectedItem[]>();
    f.mocks.getItems.mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(latest.promise);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseViewSurface
            containerItemId={f.containerId}
            viewId={f.viewId}
            service={f.service}
            openItem={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    expect(f.mocks.getItems).toHaveBeenCalledTimes(1);
    await act(async () => {
      f.emit();
      f.emit();
      obsolete.resolve([item(f.entryId, "Ancienne ligne")]);
      await advance();
    });
    expect(f.mocks.getItems).toHaveBeenCalledTimes(2);
    expect(element.textContent).not.toContain("Ancienne ligne");
    await act(async () => {
      latest.resolve([item(f.entryId, "Ligne à jour")]);
      await advance();
    });
    expect(element.textContent).toContain("Ligne à jour");
    expect(f.mocks.listDatabases).not.toHaveBeenCalled();
    await act(async () => {
      f.emit();
      await advance();
    });
    expect(f.mocks.getItems).toHaveBeenCalledTimes(3);
    expect(element.textContent).toContain("Élément actuel");
  });

  it("cancels publication from the previous embedded identity and unsubscribes it", async () => {
    const old = fixture();
    const next = fixture();
    const pending = deferred<ProjectedItem[]>();
    old.mocks.getItems.mockReturnValueOnce(pending.promise);
    const render = (f: ReturnType<typeof fixture>) => (
      <MemoryRouter>
        <DatabaseViewSurface
          containerItemId={f.containerId}
          viewId={f.viewId}
          service={f.service}
          openItem={vi.fn()}
        />
      </MemoryRouter>
    );
    await act(async () => {
      root.render(render(old));
      await advance();
    });
    expect(old.listeners.size).toBe(1);
    await act(async () => {
      root.render(render(next));
      await advance();
    });
    expect(old.listeners.size).toBe(0);
    expect(next.listeners.size).toBe(1);
    expect(element.textContent).toContain("Élément actuel");
    await act(async () => {
      pending.resolve([item(old.entryId, "Identité précédente")]);
      await advance();
    });
    expect(element.textContent).toContain("Élément actuel");
    expect(element.textContent).not.toContain("Identité précédente");
  });

  it("recovers a native container's failed initial read on the next projection", async () => {
    const f = fixture();
    f.mocks.listDatabases.mockRejectedValueOnce(new Error("local read failed"));
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseContainerPage
            containerItemId={f.containerId}
            service={f.service}
            onOpenEntry={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    expect(element.querySelector('[role="alert"]')?.textContent).toContain("actualisée");
    await act(async () => {
      f.emit();
      await advance();
    });
    expect(element.textContent).toContain("Élément actuel");
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it("recovers an embedded surface's failed read on the next projection", async () => {
    const f = fixture();
    f.mocks.getItems.mockRejectedValueOnce(new Error("local read failed"));
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseViewSurface
            containerItemId={f.containerId}
            viewId={f.viewId}
            service={f.service}
            openItem={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    expect(element.querySelector('[role="alert"]')?.textContent).toContain("chargée");
    await act(async () => {
      f.emit();
      await advance();
    });
    expect(element.textContent).toContain("Élément actuel");
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it("refuses new source properties during partial discovery but keeps source renaming available", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const f = fixture({ complete: false });
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseContainerPage
            containerItemId={f.containerId}
            service={f.service}
            onOpenEntry={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    await act(async () => {
      element.querySelector<HTMLButtonElement>('[aria-label="Options de la vue"]')?.click();
      await advance();
    });
    const properties = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".database-view-settings__row"),
    ).find((button) => button.textContent?.includes("Modifier les propriétés"));
    if (properties === undefined) throw new Error("Missing source properties screen");
    await act(async () => {
      properties.click();
      await advance();
    });
    const create = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".database-view-settings__row"),
    ).find((button) => button.textContent?.includes("Nouvelle propriété"));
    if (create === undefined) throw new Error("Missing property creation action");
    await act(async () => {
      create.click();
      await advance();
    });
    const name = document.querySelector<HTMLInputElement>('[name="property-name"]');
    const submit = document.querySelector<HTMLButtonElement>(
      '.property-editor button[type="submit"]',
    );
    if (name === null || submit === null) throw new Error("Missing property form");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        name,
        "Late property",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      submit.click();
      await advance();
    });
    expect(document.body.textContent).toContain("Attendez la fin du chargement des entrées");
    expect(f.mocks.replaceDatabaseDefinition).not.toHaveBeenCalled();
    expect(f.mocks.mutate).not.toHaveBeenCalled();
    const title = element.querySelector<HTMLTextAreaElement>(
      '[data-testid="current-source-title"]',
    );
    if (title === null) throw new Error("Missing editable source name");
    act(() => title.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        title,
        "Renamed locally",
      );
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      title.blur();
      await advance();
    });
    expect(f.mocks.replaceDatabaseDefinition).toHaveBeenCalledExactlyOnceWith(
      f.ownerId,
      expect.objectContaining({ definition: expect.objectContaining({ name: "Renamed locally" }) }),
    );
    expect(element.textContent).toContain("Élément actuel");
  });

  it("keeps a refused action visible when a background refresh succeeds", async () => {
    const f = fixture();
    const replace = vi.fn(async () => ({ ok: false, error: { title: "Renommage refusé" } }));
    const service = {
      ...f.mocks,
      replaceDatabaseDefinition: replace,
    } as unknown as LocalContentService;
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseContainerPage
            containerItemId={f.containerId}
            service={service}
            onOpenEntry={vi.fn()}
          />
        </MemoryRouter>,
      );
      await advance();
    });
    const title = element.querySelector<HTMLTextAreaElement>(
      '[data-testid="current-source-title"]',
    );
    if (title === null) throw new Error("Missing source title");
    act(() => title.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        title,
        "Titre modifié",
      );
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      title.blur();
      await advance();
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain("Renommage refusé");
    await act(async () => {
      f.emit();
      await advance();
    });
    expect(element.textContent).toContain("Renommage refusé");
    expect(element.textContent).toContain("Élément actuel");
  });
});
