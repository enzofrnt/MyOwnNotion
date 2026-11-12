// @vitest-environment jsdom
import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { RelationCatalogProvider } from "../src/features/databases/relation-catalog.tsx";
import { RelationPropertySettings } from "../src/features/databases/relation-property-settings.tsx";
import type { LocalContentService } from "../src/services/local-content.ts";

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}` as Uuid;

describe("relation source settings", () => {
  it("offers to create then remove the two-way side once a source is chosen", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const mutate = vi.fn(async () => ({ ok: true as const }));
    const service = {
      listDatabases: async () => [
        {
          itemId: id(1),
          sourceId: id(2),
          definitionRevisionId: id(9),
          definition: { name: "Achats", properties: [{ id: id(3) }] },
        },
        {
          itemId: id(4),
          sourceId: id(5),
          definitionRevisionId: id(8),
          definition: { name: "Clients", properties: [{ id: id(6) }] },
        },
      ],
      getItems: async () => [
        { id: id(1), kind: "database", lifecycle: "active", name: "Base" },
        { id: id(4), kind: "database", lifecycle: "active", name: "Clients" },
      ],
      mutate,
      subscribeProjection: () => () => {},
    } as unknown as LocalContentService;
    let current: DatabaseProperty = {
      id: id(3),
      type: "relation",
      name: "Achats liés",
      positionKey: "a",
      state: "active",
      config: { cardinality: "many", targetSourceId: id(5) },
    };
    function Harness() {
      const [property, setProperty] = useState(current);
      current = property;
      return property.type === "relation" ? (
        <RelationPropertySettings property={property} onChange={(edit) => setProperty(edit)} />
      ) : null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const pairRow = () => container.querySelector<HTMLButtonElement>("[data-relation-pair]");
    try {
      await act(async () =>
        root.render(
          <RelationCatalogProvider service={service}>
            <Harness />
          </RelationCatalogProvider>,
        ),
      );
      expect(pairRow()?.textContent).toContain("Désactivé");
      await act(async () => pairRow()?.click());
      const name = document.querySelector<HTMLInputElement>(
        'input[aria-label="Nom de la propriété liée"]',
      );
      await act(async () => {
        if (name !== null) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
            name,
            "Projets liés",
          );
          name.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      const enable = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) =>
        item.textContent?.includes("Activer"),
      );
      await act(async () => enable?.click());
      expect(mutate).toHaveBeenCalledWith(
        "database.relation.pair.create",
        expect.objectContaining({
          databaseId: id(2),
          relationPropertyId: id(3),
          inverseName: "Projets liés",
          baseRevisionId: id(9),
          inverseBaseRevisionId: id(8),
        }),
        [id(9), id(8)],
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("selects a source with no entries, preserving it when cardinality changes", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const service = {
      listDatabases: async () => [
        { itemId: id(1), sourceId: id(2), definition: { name: "Achats" } },
      ],
      getItems: async () => [
        { id: id(1), name: "Page hôte", kind: "database", lifecycle: "active" },
      ],
      subscribeProjection: () => () => {},
    } as unknown as LocalContentService;
    let current: DatabaseProperty = {
      id: id(3),
      type: "relation",
      name: "Achats liés",
      config: { cardinality: "many" },
      positionKey: "a",
      state: "active",
    };
    function Harness() {
      const [property, setProperty] = useState(current);
      current = property;
      return property.type === "relation" ? (
        <RelationPropertySettings property={property} onChange={(edit) => setProperty(edit)} />
      ) : null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <RelationCatalogProvider service={service}>
            <Harness />
          </RelationCatalogProvider>,
        ),
      );
      await act(async () =>
        container.querySelector<HTMLButtonElement>(".rollup-settings__row")?.click(),
      );
      const option = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
        (item) => item.textContent === "Achats",
      );
      expect(option).toBeDefined();
      await act(async () => option?.click());
      expect(current.config).toEqual({ cardinality: "many", targetSourceId: id(2) });
      await act(async () =>
        container.querySelector<HTMLButtonElement>("[data-relation-limit]")?.click(),
      );
      const onePage = [...document.querySelectorAll<HTMLElement>("[role=menuitemradio]")].find(
        (item) => item.textContent === "1 page",
      );
      expect(onePage).toBeDefined();
      await act(async () => onePage?.click());
      // Reducing cardinality needs explicit confirmation, not a silent rewrite.
      expect(current.config).toEqual({ cardinality: "many", targetSourceId: id(2) });
      const confirm = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Confirmer",
      );
      await act(async () => confirm?.click());
      expect(current.config).toEqual({ cardinality: "one", targetSourceId: id(2) });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
