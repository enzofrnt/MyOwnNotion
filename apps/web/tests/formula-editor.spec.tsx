// @vitest-environment jsdom
import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormulaEditor } from "../src/features/databases/formula-editor.tsx";
import type { DatabaseViewRow } from "../src/services/databases.ts";

const id = (suffix: string) => `018f4000-0000-7000-8000-0000000000${suffix}` as Uuid;
const price: DatabaseProperty = {
  id: id("01"),
  name: "Prix",
  type: "number",
  positionKey: "a",
  state: "active",
  config: {},
};
const relation: DatabaseProperty = {
  id: id("02"),
  name: "Achats",
  type: "relation",
  positionKey: "b",
  state: "active",
  config: { cardinality: "many" },
};
const total: DatabaseProperty = {
  id: id("03"),
  name: "Total",
  type: "rollup",
  positionKey: "c",
  state: "active",
  config: { relationPropertyId: relation.id, targetPropertyId: id("ff"), aggregate: "sum" },
};
function formula(
  expression: string,
  suffix = "04",
): Extract<DatabaseProperty, { type: "formula" }> {
  return {
    id: id(suffix),
    name: "Formule",
    type: "formula",
    positionKey: "d",
    state: "active",
    config: { expression },
  };
}
function row(suffix: string, title: string, decimal: string, sum: number): DatabaseViewRow {
  return {
    entryId: id(suffix),
    revisionId: id(`9${suffix.slice(1)}`),
    title,
    values: { [price.id]: { kind: "number", decimal } },
    relationTargets: { [relation.id]: [id("c1"), id("c2")] },
    rollupValues: { [total.id]: sum },
    groupId: null,
    syncState: "synced",
  } as unknown as DatabaseViewRow;
}
const rows = [row("11", "Alpha", "10", 30), row("12", "Bêta", "25", 70)];

describe("formula editor", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = () => {};
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(
    property: Extract<DatabaseProperty, { type: "formula" }>,
    handlers: { onSave?: (expression: string) => void; onClose?: () => void } = {},
  ): Promise<void> {
    await act(async () =>
      root.render(
        <FormulaEditor
          property={property}
          properties={[price, relation, total, property]}
          previewRow={rows[0]}
          previewRows={rows}
          open
          onClose={handlers.onClose ?? (() => {})}
          onSave={handlers.onSave ?? (() => {})}
        />,
      ),
    );
  }
  const result = (): string => document.querySelector(".formula-editor__result")?.textContent ?? "";
  const input = (): HTMLTextAreaElement =>
    document.querySelector<HTMLTextAreaElement>(".formula-editor__input") as HTMLTextAreaElement;
  async function type(value: string): Promise<void> {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input(), value);
      input().setSelectionRange(value.length, value.length);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function close(): Promise<void> {
    await act(async () =>
      document.querySelector<HTMLButtonElement>(".ui-overlay__dismiss")?.click(),
    );
  }

  it("previews the entry that is selected, including its computed rollup", async () => {
    await render(formula('prop("Prix") + prop("Total")'));
    expect(result()).toContain("40");
    const picker = document.querySelector<HTMLSelectElement>(
      ".formula-editor__preview-picker select",
    ) as HTMLSelectElement;
    await act(async () => {
      picker.value = rows[1]?.entryId as string;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(picker.selectedOptions[0]?.textContent).toBe("Bêta");
    expect(result()).toContain("95");
    expect(result()).toContain("Type : numéro");
  });

  it("never replaces the saved formula with an invalid draft, and keeps the draft", async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const property = formula('prop("Prix") * 2', "05");
    await render(property, { onSave, onClose });
    await type("1 +");
    expect(result()).toContain("Expression attendue. [2,3]");
    expect(result()).toContain("la formule enregistrée reste inchangée");
    await close();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    // Reopening restores the draft and its error instead of losing the work.
    await act(async () => root.render(<div />));
    await render(property, { onSave, onClose });
    expect(input().value).toBe("1 +");

    await type("1 + 2");
    expect(result()).toContain("3");
    await close();
    expect(onSave).toHaveBeenCalledExactlyOnceWith("1 + 2");
  });

  it("flags a broken reference and a formula that refers to itself", async () => {
    await render(formula('prop("Disparue")', "06"));
    expect(result()).toContain("Propriété inconnue « Disparue »");
    await type('prop("Formule") + 1');
    expect(result()).toContain("circulaire");
  });

  it("filters the reference while typing and inserts with the keyboard", async () => {
    await render(formula("1", "07"));
    await type("rou");
    const options = [...document.querySelectorAll(".formula-editor__item-name")].map(
      (element) => element.textContent,
    );
    expect(options).toEqual(["round()"]);
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(input().value).toBe("round()");
  });
});
