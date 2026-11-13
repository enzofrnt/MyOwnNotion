// @vitest-environment jsdom
import type { Uuid } from "@myownnotion/domain";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  RelationCatalogProvider,
  useRelationCandidates,
  useRelationCatalog,
} from "../src/features/databases/relation-catalog.tsx";
import type { LocalContentService } from "../src/services/local-content.ts";

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}` as Uuid;
const source = (n: number) => ({
  itemId: id(1),
  sourceId: id(n),
  definition: { name: `Source ${n}` },
});

describe("relation catalogue loading", () => {
  it("offers a real retry after source discovery fails", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let attempts = 0;
    const service = {
      listDatabases: async () => {
        if (++attempts === 1) throw new Error("unavailable");
        return [source(2)];
      },
      getItems: async () => [{ id: id(1), kind: "database", lifecycle: "active", name: "Owner" }],
      subscribeProjection: () => () => {},
    } as unknown as LocalContentService;
    function Harness() {
      const catalogue = useRelationCatalog();
      return (
        <>
          <button type="button" onClick={catalogue?.retry}>
            Réessayer
          </button>
          <output>
            {catalogue?.error ?? catalogue?.sources.map(({ name }) => name).join(",")}
          </output>
        </>
      );
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
      expect(container.querySelector("output")?.textContent).toContain("ne sont pas disponibles");
      await act(async () => container.querySelector("button")?.click());
      expect(container.querySelector("output")?.textContent).toBe("Source 2");
      expect(attempts).toBe(2);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("does not show a delayed answer from a source that is no longer selected", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let resolveFirst: ((items: unknown[]) => void) | undefined;
    const firstAnswer = new Promise<unknown[]>((resolve) => {
      resolveFirst = resolve;
    });
    const service = {
      listDatabases: async () => [source(2), source(3)],
      getItems: async (ids: readonly Uuid[]) => {
        if (ids.includes(id(1)))
          return [{ id: id(1), kind: "database", lifecycle: "active", name: "Owner" }];
        if (ids.includes(id(10))) return firstAnswer;
        return [{ id: id(11), kind: "folder", lifecycle: "active", name: "Second source entry" }];
      },
      listDatabaseEntries: async () => [
        { entryItemId: id(10), sourceId: id(2) },
        { entryItemId: id(11), sourceId: id(3) },
      ],
      subscribeProjection: () => () => {},
    } as unknown as LocalContentService;
    let chooseSource: (value: Uuid) => void = () => {};
    function Harness() {
      const [selected, setSelected] = useState(id(2));
      chooseSource = setSelected;
      const { options } = useRelationCandidates(selected);
      return <output>{options.map(({ label }) => label).join(",")}</output>;
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
      await act(async () => chooseSource(id(3)));
      expect(container.textContent).toBe("Second source entry");
      await act(async () =>
        resolveFirst?.([
          { id: id(10), kind: "page", lifecycle: "active", name: "Old source entry" },
        ]),
      );
      expect(container.textContent).toBe("Second source entry");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
