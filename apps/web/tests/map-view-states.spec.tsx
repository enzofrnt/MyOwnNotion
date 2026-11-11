// @vitest-environment jsdom
import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseViewPage } from "../src/services/databases.ts";

const id = (suffix: string) => `018f5000-0000-7000-8000-0000000003${suffix}` as Uuid;
const property: DatabaseProperty = {
  id: id("01"),
  name: "Lieu",
  type: "place",
  positionKey: "a",
  state: "active",
  config: {},
};
const view = {
  id: id("02"),
  name: "Carte",
  type: "map",
  positionKey: "a",
  state: "active",
  properties: [],
  filter: { mode: "all", criteria: [] },
  sorts: [],
  group: null,
  options: { placePropertyId: property.id },
} as never;
const page = {
  rows: [
    {
      entryId: id("11"),
      revisionId: id("12"),
      title: "Visite",
      values: {
        [property.id]: {
          kind: "place",
          placeId: "louvre",
          name: "Musée du Louvre",
          address: "75001 Paris",
          latitude: 48.86,
          longitude: 2.33,
        },
      },
      relationTargets: {},
      groupId: null,
      syncState: "synced",
    },
  ],
} as unknown as DatabaseViewPage;

describe("map view states", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetModules();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(onOpenEntry = vi.fn()): Promise<void> {
    const { MapView } = await import("../src/features/databases/map-view.tsx");
    const { ThemeProvider } = await import("../src/ui/theme-provider.tsx");
    await act(async () =>
      root.render(
        <ThemeProvider>
          <MapView
            properties={[property]}
            view={view}
            page={page}
            onOpenEntry={onOpenEntry}
            onChangeView={() => {}}
          />
        </ThemeProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("explains a missing key without offering a pointless retry, and keeps places readable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ browserKey: null }), { status: 200 })),
    );
    const onOpenEntry = vi.fn();
    await render(onOpenEntry);
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "La carte n’est pas configurée",
    );
    expect(container.textContent).not.toContain("Réessayer");
    const item = container.querySelector<HTMLButtonElement>(".database-map__list button");
    expect(item?.textContent).toContain("Visite");
    expect(item?.textContent).toContain("Musée du Louvre — 75001 Paris");
    await act(async () => item?.click());
    expect(onOpenEntry).toHaveBeenCalledWith(id("11"), item);
  });

  it("retries after an outage instead of remembering the failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ browserKey: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await render();
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "La configuration de la carte n’a pas pu être chargée.",
    );
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Réessayer",
    );
    await act(async () => {
      retry?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("n’est pas configurée");
  });
});
