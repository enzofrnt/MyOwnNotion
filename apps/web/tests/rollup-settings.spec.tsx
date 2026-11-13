// @vitest-environment jsdom
import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RollupPropertySettings } from "../src/features/databases/rollup-settings.tsx";

const id = (suffix: string) => `018f4000-0000-7000-8000-0000000000${suffix}` as Uuid;
const purchases = id("a1");
const clients = id("a2");
const relation = (suffix: string, name: string): DatabaseProperty => ({
  id: id(suffix),
  name,
  type: "relation",
  positionKey: suffix,
  state: "active",
  config: { cardinality: "many" },
});
const toPurchases = relation("01", "Achats");
const toClients = relation("02", "Clients");
const targets = [
  { id: id("11"), name: "Achat", type: "title", sourceId: purchases },
  { id: id("12"), name: "Montant", type: "number", sourceId: purchases },
  { id: id("13"), name: "Date", type: "date", sourceId: purchases },
  { id: id("21"), name: "Client", type: "title", sourceId: clients },
  { id: id("22"), name: "Ville", type: "text", sourceId: clients },
];
const relationSources = { [toPurchases.id]: [purchases], [toClients.id]: [clients] };

function rollup(config: Record<string, unknown>): Extract<DatabaseProperty, { type: "rollup" }> {
  return {
    id: id("03"),
    name: "Total",
    type: "rollup",
    positionKey: "c",
    state: "active",
    config: { relationPropertyId: toPurchases.id, ...config },
  } as Extract<DatabaseProperty, { type: "rollup" }>;
}

describe("rollup settings", () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: DatabaseProperty;
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

  async function render(
    initial: Extract<DatabaseProperty, { type: "rollup" }>,
    properties: readonly DatabaseProperty[] = [toPurchases, toClients],
  ): Promise<void> {
    current = initial;
    function Harness() {
      const [property, setProperty] = useState<DatabaseProperty>(initial);
      current = property;
      return property.type === "rollup" ? (
        <RollupPropertySettings
          property={property}
          properties={properties}
          targets={targets}
          relationSources={relationSources}
          onChange={(edit) => setProperty(edit)}
        />
      ) : null;
    }
    await act(async () => root.render(<Harness />));
  }
  const rows = (): HTMLButtonElement[] => [
    ...container.querySelectorAll<HTMLButtonElement>(".rollup-settings__row"),
  ];
  async function open(index: number): Promise<string[]> {
    await act(async () => rows()[index]?.click());
    return items().map((item) => item.textContent ?? "");
  }
  const items = (): HTMLElement[] => {
    const menus = [...document.querySelectorAll<HTMLElement>(".rollup-settings__menu")];
    return [...(menus.at(-1)?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
  };
  async function choose(label: string): Promise<void> {
    const item = items().find((candidate) => candidate.textContent === label);
    if (item === undefined) throw new Error(`Missing menu item ${label}`);
    await act(async () => item.click());
  }

  it("only offers the properties of the source the relation reaches", async () => {
    await render(rollup({ targetPropertyId: id("12"), aggregate: "sum" }));
    expect(rows().map((row) => row.textContent)).toEqual([
      "RelationAchats",
      "Propriété cibleMontant",
      "CalculerSomme",
    ]);
    expect(await open(1)).toEqual(["Achat", "Montant", "Date"]);
  });

  it("offers the calculations the target type supports", async () => {
    await render(rollup({ targetPropertyId: id("12"), aggregate: "sum" }));
    expect(await open(2)).toEqual([
      "Afficher l’original",
      "Afficher les valeurs uniques",
      "Quantité",
      "Pourcentage",
      "Plus d’options",
    ]);
  });

  it("resets a calculation the new target cannot compute", async () => {
    await render(rollup({ targetPropertyId: id("12"), aggregate: "sum" }));
    await open(1);
    await choose("Date");
    expect(current.config).toEqual({
      relationPropertyId: toPurchases.id,
      targetPropertyId: id("13"),
      aggregate: "show_original",
    });
  });

  it("restarts from the linked title when the relation changes", async () => {
    await render(rollup({ targetPropertyId: id("12"), aggregate: "sum" }));
    await open(0);
    await choose("Clients");
    expect(current.config).toEqual({
      relationPropertyId: toClients.id,
      targetPropertyId: id("21"),
      aggregate: "show_original",
    });
  });

  it("explains a configuration that became invalid and locks dependent choices", async () => {
    // A property from Clients cannot be used through the Achats relation,
    // even when that foreign property exists in the global metadata.
    await render(rollup({ targetPropertyId: id("22"), aggregate: "sum" }));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("propriété cible");
    expect(rows()[2]?.disabled).toBe(true);
    await render(rollup({ targetPropertyId: id("11"), aggregate: "sum" }));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("ne s’applique pas");
    await render(rollup({ targetPropertyId: id("99"), aggregate: "sum" }));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("propriété cible");
    expect(rows()[2]?.disabled).toBe(true);
    await render(rollup({ targetPropertyId: id("12"), aggregate: "sum" }), [toClients]);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("relation");
    expect(rows()[1]?.disabled).toBe(true);
  });
});
