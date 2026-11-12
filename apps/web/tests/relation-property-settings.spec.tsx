// @vitest-environment jsdom
import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { RelationCatalogProvider } from "../src/features/databases/relation-catalog.tsx";
import { RelationPropertySettings } from "../src/features/databases/relation-property-settings.tsx";
import type { LocalContentService } from "../src/services/local-content.ts";

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}` as Uuid;

describe("relation source settings", () => {
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
