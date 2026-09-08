// @vitest-environment jsdom
import type { DatabaseDto } from "@myownnotion/contracts";
import { type DatabaseDefinition, generateUuidV7 } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabasePage } from "../src/features/databases/database-page.tsx";
import { DatabaseToolbar } from "../src/features/databases/database-toolbar.tsx";
import type { DatabaseViewPage, DatabaseViewResult } from "../src/services/databases.ts";

function input(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function database(): DatabaseDto {
  const databaseId = generateUuidV7();
  const titlePropertyId = generateUuidV7();
  return {
    databaseId,
    definitionRevisionId: generateUuidV7(),
    lifecycle: "active",
    name: "Projects",
    definition: {
      format: "myownnotion.database-definition+json",
      formatVersion: 1,
      databaseId,
      properties: [
        {
          id: titlePropertyId,
          name: "Title",
          type: "title",
          positionKey: "a",
          state: "active",
          config: {},
        },
      ],
      views: [
        {
          id: generateUuidV7(),
          name: "Table",
          type: "table",
          positionKey: "a",
          state: "active",
          properties: [{ propertyId: titlePropertyId, visible: true, positionKey: "a" }],
          filter: { mode: "all", criteria: [] },
          sorts: [],
          group: null,
          options: { density: "comfortable", freezeTitle: true },
        },
      ],
      taskRoles: null,
    },
  } as DatabaseDto;
}

describe("database page interaction durability", () => {
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

  it.each(["accepted", "rejected"] as const)(
    "keeps a column choice visible during a delayed write, then handles %s",
    async (outcome) => {
      const initial = database().definition as unknown as DatabaseDefinition;
      const propertyId = generateUuidV7();
      const current: DatabaseDefinition = {
        ...initial,
        properties: [
          ...initial.properties,
          {
            id: propertyId,
            type: "text",
            name: "Details",
            state: "active",
            positionKey: "b",
            config: {},
          },
        ],
        views: initial.views.map((view) => ({
          ...view,
          properties: [...view.properties, { propertyId, visible: true, positionKey: "b" }],
        })),
      };
      let settle!: () => void;
      const saved = new Promise<void>((resolve, reject) => {
        settle = () => (outcome === "accepted" ? resolve() : reject(new Error("write refused")));
      });
      const onChange = vi.fn<(_: DatabaseDefinition) => Promise<void>>().mockReturnValue(saved);
      const viewId = current.views[0]?.id;
      if (viewId === undefined) throw new Error("Missing initial view");
      const render = (definition: DatabaseDefinition) =>
        root.render(
          <DatabaseToolbar
            definition={definition}
            activeViewId={viewId}
            onSelectView={vi.fn()}
            onChange={onChange}
          />,
        );
      act(() => render(current));
      const checkbox = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1];
      if (checkbox === undefined) throw new Error("Missing column control");
      act(() => checkbox.click());
      expect(checkbox.checked).toBe(false);
      expect(checkbox.disabled).toBe(true);
      act(() => checkbox.click());
      expect(onChange).toHaveBeenCalledOnce();
      const proposed = onChange.mock.calls[0]?.[0];
      if (proposed === undefined) throw new Error("Missing proposed definition");
      expect(proposed.views[0]?.properties[1]?.visible).toBe(false);
      if (outcome === "accepted") act(() => render(proposed));
      await act(async () => {
        settle();
        await saved.catch(() => undefined);
      });
      expect(checkbox.checked).toBe(outcome === "rejected");
      expect(checkbox.disabled).toBe(false);
      if (outcome === "rejected") expect(container.textContent).toContain("Réessayez");
      act(() => render(outcome === "accepted" ? current : proposed));
      expect(checkbox.checked).toBe(outcome === "accepted");
    },
  );

  it("submits the latest option text even before React commits its next render", async () => {
    const onReplaceDefinition = vi.fn();
    const initialDatabase = database();
    const renderPage = (value: DatabaseDto) => (
      <MemoryRouter initialEntries={[`/notes/${value.databaseId}`]}>
        <DatabasePage
          database={value}
          entries={[]}
          onReplaceDefinition={onReplaceDefinition}
          onCreateEntry={vi.fn()}
          onOpenEntry={vi.fn()}
        />
      </MemoryRouter>
    );
    act(() => root.render(renderPage(initialDatabase)));

    act(() => container.querySelector<HTMLButtonElement>(".database-page__header button")?.click());
    const name = container.querySelector<HTMLInputElement>('[name="property-name"]');
    expect(name).not.toBeNull();
    act(() => {
      if (name === null) return;
      input(name, "Status");
    });

    const type = container.querySelector<HTMLSelectElement>('[name="property-type"]');
    expect(type).not.toBeNull();
    act(() => {
      if (type === null) return;
      type.value = "status";
      type.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const options = container.querySelector<HTMLInputElement>(
      '.property-editor input[placeholder="Prévu, En cours, Terminé"]',
    );
    const save = container.querySelector<HTMLButtonElement>(
      '.property-editor button[type="submit"]',
    );
    expect(options).not.toBeNull();
    expect(save).not.toBeNull();
    if (options === null || save === null) return;

    // The browser has painted the owner's final input, but React has not yet
    // received its state event when a synchronization projection rerenders the
    // parent. A controlled field used to repaint the empty draft here on both
    // WebKit viewports; submission then created a status with zero options.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      options,
      "To do, Done",
    );
    act(() =>
      root.render(
        renderPage({
          ...initialDatabase,
          definitionRevisionId: generateUuidV7(),
        }),
      ),
    );
    expect(options.value).toBe("To do, Done");

    await act(async () => {
      save.click();
      await Promise.resolve();
    });

    expect(onReplaceDefinition).toHaveBeenCalledTimes(1);
    const submitted = onReplaceDefinition.mock.calls[0]?.[0] as DatabaseDefinition;
    const status = submitted.properties.find((property) => property.name === "Status");
    expect(status?.type).toBe("status");
    expect(status?.config).toMatchObject({
      options: [{ label: "To do" }, { label: "Done" }],
    });
  });

  it("keeps the entry loading region mounted during projection refresh", () => {
    const value = database();
    const viewId = value.definition.views[0]?.id;
    if (viewId === undefined) throw new Error("Missing view");
    const page: DatabaseViewPage = {
      databaseId: value.databaseId,
      viewId,
      definitionRevisionId: value.definitionRevisionId,
      generation: 1,
      coverage: "complete",
      availableCount: 1,
      expectedCount: 1,
      rows: [
        {
          entryId: generateUuidV7(),
          revisionId: generateUuidV7(),
          title: "Stable entry",
          values: {},
          relationTargets: {},
          groupId: null,
          syncState: "synced",
        },
      ],
      groups: [],
      nextCursor: "local.next",
      source: "local",
      staleCursorRecovered: false,
    };
    const query = vi.fn<() => Promise<DatabaseViewResult>>(() => new Promise(() => undefined));
    const render = (state: "ready" | "loading") =>
      root.render(
        <MemoryRouter>
          <DatabasePage
            database={value}
            entries={[]}
            queryPage={page}
            queryState={state}
            onQueryView={query}
            onReplaceDefinition={vi.fn()}
            onCreateEntry={vi.fn()}
            onOpenEntry={vi.fn()}
          />
        </MemoryRouter>,
      );
    act(() => render("ready"));
    const region = container.querySelector(".database-pagination");
    const trigger = container.querySelector("[data-entry-trigger]");
    expect(region).not.toBeNull();
    expect(trigger).not.toBeNull();
    act(() => render("loading"));
    expect(region?.isConnected).toBe(true);
    expect(container.querySelector(".database-pagination")).toBe(region);
    expect(container.querySelector("[data-entry-trigger]")).toBe(trigger);
    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(region?.textContent).toContain("Actualisation");
    expect(region?.querySelector("button")?.disabled).toBe(true);
    act(() => render("ready"));
    expect(container.querySelector(".database-pagination")).toBe(region);
    expect(region?.textContent).toContain("1 entrée chargée");
    expect(region?.querySelector("button")?.disabled).toBe(false);
  });

  it("appends cursor rows and retains them when loading the next page fails", async () => {
    const value = database();
    const viewId = value.definition.views[0]?.id;
    if (viewId === undefined) throw new Error("Missing view");
    const row = (title: string) => ({
      entryId: generateUuidV7(),
      revisionId: generateUuidV7(),
      title,
      values: {},
      relationTargets: {},
      groupId: null,
      syncState: "synced" as const,
    });
    const first: DatabaseViewPage = {
      databaseId: value.databaseId,
      viewId,
      definitionRevisionId: value.definitionRevisionId,
      generation: 1,
      coverage: "partial",
      availableCount: 3,
      expectedCount: 4,
      rows: [row("First")],
      groups: [],
      nextCursor: "local.second",
      source: "local",
      staleCursorRecovered: false,
    };
    const query = vi
      .fn<(_view: string, cursor?: string) => Promise<DatabaseViewResult>>()
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...first, rows: [row("Second")], nextCursor: "local.third" },
      })
      .mockRejectedValueOnce(new Error("temporary transport failure"));
    await act(async () =>
      root.render(
        <MemoryRouter>
          <DatabasePage
            database={value}
            entries={[]}
            onReplaceDefinition={vi.fn()}
            onCreateEntry={vi.fn()}
            onOpenEntry={vi.fn()}
            onQueryView={query}
          />
        </MemoryRouter>,
      ),
    );
    const pagination = () => container.querySelector(".database-pagination");
    expect(pagination()?.textContent).toContain("1 entrée chargée");
    await act(async () => {
      pagination()?.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(query).toHaveBeenLastCalledWith(viewId, "local.second");
    expect(pagination()?.textContent).toContain("2 entrées chargées");
    expect(container.textContent).toContain("Données locales partielles : 3 sur 4");
    await act(async () => {
      pagination()?.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(pagination()?.textContent).toContain("2 entrées chargées");
    expect(container.textContent).toContain("Les entrées suivantes n'ont pas pu être chargées");
  });

  it("reloads subsequent pages before restoring the canonical entry trigger", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      const value = database();
      const viewId = value.definition.views[0]?.id;
      if (viewId === undefined) throw new Error("Missing view");
      const target = generateUuidV7();
      const row = (entryId: ReturnType<typeof generateUuidV7>, title: string) => ({
        entryId,
        revisionId: generateUuidV7(),
        title,
        values: {},
        relationTargets: {},
        groupId: null,
        syncState: "synced" as const,
      });
      const first: DatabaseViewPage = {
        databaseId: value.databaseId,
        viewId,
        definitionRevisionId: value.definitionRevisionId,
        generation: 1,
        coverage: "complete",
        availableCount: 2,
        expectedCount: 2,
        rows: [row(generateUuidV7(), "First")],
        groups: [],
        nextCursor: "local.second",
        source: "local",
        staleCursorRecovered: false,
      };
      const query = vi
        .fn<(_view: string, cursor?: string) => Promise<DatabaseViewResult>>()
        .mockResolvedValueOnce({ ok: true, value: first })
        .mockResolvedValueOnce({
          ok: true,
          value: { ...first, rows: [row(target, "Last")], nextCursor: null },
        });
      await act(async () =>
        root.render(
          <MemoryRouter>
            <DatabasePage
              database={value}
              entries={[]}
              returnFocusEntryId={target}
              onReplaceDefinition={vi.fn()}
              onCreateEntry={vi.fn()}
              onOpenEntry={vi.fn()}
              onQueryView={query}
            />
          </MemoryRouter>,
        ),
      );
      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(viewId, "local.second");
      expect(container.querySelector(".database-pagination")?.textContent).toContain(
        "2 entrées chargées",
      );
      expect(document.activeElement?.getAttribute("data-entry-trigger")).toBe(target);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a new entry title through a concurrent projection render", async () => {
    const onCreateEntry = vi.fn().mockResolvedValue(undefined);
    const initialDatabase = database();
    const renderPage = (value: DatabaseDto) => (
      <MemoryRouter initialEntries={[`/notes/${value.databaseId}`]}>
        <DatabasePage
          database={value}
          entries={[]}
          onReplaceDefinition={vi.fn()}
          onCreateEntry={onCreateEntry}
          onOpenEntry={vi.fn()}
        />
      </MemoryRouter>
    );
    act(() => root.render(renderPage(initialDatabase)));

    const title = container.querySelector<HTMLInputElement>(".database-entry-create input");
    const submit = container.querySelector<HTMLButtonElement>(
      '.database-entry-create button[type="submit"]',
    );
    expect(title).not.toBeNull();
    expect(submit).not.toBeNull();
    if (title === null || submit === null) return;

    // Model WebKit painting the final input just before a synchronization
    // projection rerenders the parent. React has not observed an input event,
    // so a controlled field would repaint the old empty value here.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      title,
      "Offline roadmap",
    );
    act(() =>
      root.render(
        renderPage({
          ...initialDatabase,
          definitionRevisionId: generateUuidV7(),
        }),
      ),
    );
    expect(title.value).toBe("Offline roadmap");

    await act(async () => {
      submit.click();
      await Promise.resolve();
    });

    expect(onCreateEntry).toHaveBeenCalledOnce();
    expect(onCreateEntry).toHaveBeenCalledWith("Offline roadmap");
    expect(title.value).toBe("");
  });
});
