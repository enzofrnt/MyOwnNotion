// @vitest-environment jsdom
import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelationCatalogProvider } from "../src/features/databases/relation-catalog.tsx";
import { RelationDraftMenu } from "../src/features/databases/relation-value-menu.tsx";
import type { LocalContentService } from "../src/services/local-content.ts";

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}` as Uuid;
const owner = id(1);
const source = id(2);
const other = id(3);
const relation = (
  config: Record<string, unknown>,
): Extract<DatabaseProperty, { type: "relation" }> =>
  ({
    id: id(20),
    name: "Achats liés",
    type: "relation",
    positionKey: "a",
    state: "active",
    config: { cardinality: "many", ...config },
  }) as Extract<DatabaseProperty, { type: "relation" }>;

function serviceOf(rows: { entryItemId: Uuid; sourceId: Uuid }[]): LocalContentService {
  return {
    listDatabases: async () => [
      { itemId: owner, sourceId: source, definition: { name: "Achats" } },
      { itemId: owner, sourceId: other, definition: { name: "Autre" } },
    ],
    getItems: async (ids: readonly Uuid[]) =>
      ids.includes(owner)
        ? [{ id: owner, kind: "database", lifecycle: "active", name: "Base" }]
        : rows
            .filter((row) => ids.includes(row.entryItemId))
            .map((row) => ({
              id: row.entryItemId,
              kind: "page",
              lifecycle: "active",
              name: `Page ${row.entryItemId.slice(-2)}`,
            })),
    listDatabaseEntries: async () => rows,
    subscribeProjection: () => () => {},
  } as unknown as LocalContentService;
}

describe("relation value menu", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function open(
    property: ReturnType<typeof relation>,
    rows: { entryItemId: Uuid; sourceId: Uuid }[],
    input: readonly string[] = [],
  ) {
    const onChange = vi.fn();
    const service = serviceOf(rows);
    await act(async () =>
      root.render(
        <RelationCatalogProvider service={service}>
          <RelationDraftMenu
            property={property}
            input={input}
            options={[]}
            id="field"
            onChange={onChange}
          />
        </RelationCatalogProvider>,
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".option-menu__trigger")?.click(),
    );
    return onChange;
  }
  const items = (): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>("[role^=menuitem]"),
  ];

  it("only lists the configured source's entries and filters them by search", async () => {
    const rows = [
      { entryItemId: id(31), sourceId: source },
      { entryItemId: id(32), sourceId: other },
    ];
    await open(relation({ targetSourceId: source }), rows);
    const labels = items().map((item) => item.textContent ?? "");
    // Cross-source entries never appear; the clear-page item still does.
    expect(labels).toContainEqual(expect.stringContaining("Page 31"));
    expect(labels.join(" ")).not.toContain("Page 32");
    const search = document.querySelector<HTMLInputElement>(".property-settings__field input");
    await act(async () => {
      if (search !== null) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          search,
          "zzz",
        );
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(document.body.textContent).toContain("Aucune page correspondante");
  });

  it("adds to the selection and offers removal for a retained out-of-source link", async () => {
    const rows = [{ entryItemId: id(31), sourceId: source }];
    const onChange = await open(relation({ targetSourceId: source }), rows, [id(32)]);
    const available = items().find((item) => item.textContent?.includes("Page 31"));
    await act(async () => available?.click());
    expect(onChange).toHaveBeenCalledWith([id(32), id(31)]);
    // Picking an option closes the menu; reopen it to inspect the retained
    // out-of-source row instead of depending on whether this engine keeps the
    // popover mounted after the pick.
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".option-menu__trigger")?.click(),
    );
    const retained = await vi.waitFor(
      () => {
        const node = items().find((item) => item.textContent?.includes("Retirer"));
        // The retained label is resolved through the catalogue, one asynchronous
        // lookup per out-of-source value; a slower runner needs more than the
        // default one second.
        if (node === undefined) throw new Error("Retained link row is not rendered yet");
        return node;
      },
      { timeout: 10_000 },
    );
    expect(retained.textContent).toContain("hors source");
    await act(async () => retained.click());
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("keeps the legacy workspace list for an unconfigured relation", async () => {
    await open(relation({}), [], []);
    // No configured source: the historic fallback list is preserved rather than
    // silently becoming empty for relations that predate the source identity.
    expect(document.body.textContent).not.toContain("La source liée n’est pas disponible");
  });

  it("writes the partner edge when the inverse side is edited", async () => {
    const rows = [{ entryItemId: id(31), sourceId: source }];
    const revision = id(90);
    const mutate = vi.fn(async () => ({ ok: true as const }));
    const service = {
      ...serviceOf(rows),
      mutate,
      getItem: async () => ({ id: id(31), currentRevisionId: revision }),
    } as unknown as LocalContentService;
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <RelationCatalogProvider service={service}>
          <RelationDraftMenu
            property={relation({
              targetSourceId: source,
              reciprocalPropertyId: id(40),
              inverseEdges: true,
            })}
            input={[]}
            options={[]}
            entryId={id(50)}
            id="field"
            onChange={onChange}
          />
        </RelationCatalogProvider>,
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".option-menu__trigger")?.click(),
    );
    const available = items().find((item) => item.textContent?.includes("Page 31"));
    expect(available).toBeDefined();
    await act(async () => available?.click());
    expect(mutate).toHaveBeenCalledWith(
      "database.entry.relation.patch",
      {
        databaseId: owner,
        entryId: id(31),
        propertyId: id(40),
        targetItemId: id(50),
        present: true,
        baseRevisionId: revision,
      },
      [revision],
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
