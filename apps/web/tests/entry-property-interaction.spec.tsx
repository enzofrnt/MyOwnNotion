// @vitest-environment jsdom
import type { DatabaseEntryDto } from "@myownnotion/contracts";
import { previewDefinitionImpact } from "@myownnotion/domain";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntrySchemaImpact } from "../src/features/databases/edit-entry-properties.ts";
import { EntryPanel } from "../src/features/databases/entry-panel.tsx";
import { reviewDefinition, reviewId, reviewPage } from "../src/ui/ui-lab-review-fixtures.ts";

function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const delay = async (ms = 60) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
describe("entry property configuration menus", () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  function render(checkImpact = false) {
    const saves = vi.fn(),
      edits = vi.fn();
    const row = reviewPage.rows[0];
    if (row === undefined) throw Error();
    const entry: DatabaseEntryDto = {
      ...row,
      databaseId: reviewDefinition.databaseId,
      lifecycle: "active",
      document: null,
      revisionId: reviewId(50),
    } as unknown as DatabaseEntryDto;
    function Harness() {
      const [definition, setDefinition] = useState(reviewDefinition);
      return (
        <EntryPanel
          entry={entry}
          definition={definition}
          onSaveValues={saves}
          onEditDefinition={async (change, confirmed = false) => {
            edits(change, confirmed);
            const next = change(definition);
            if (checkImpact) {
              const impact = await previewDefinitionImpact({
                current: definition,
                candidate: next,
                baseRevisionId: reviewId(50),
                entries: [],
              });
              if (impact.destructive && !confirmed) throw new EntrySchemaImpact(impact);
            }
            setDefinition(next);
            return next;
          }}
          onClose={() => {}}
        />
      );
    }
    act(() => root.render(<Harness />));
    return { edits, saves };
  }
  const button = (name: string) => {
    const el = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    if (el === null) throw Error(`Missing ${name}`);
    return el;
  };
  const configure = async (name: string) => {
    act(() => button(`Modifier la propriété ${name}`).click());
    await delay();
  };
  const settingsText = () =>
    document.querySelector('[role="dialog"][aria-label^="Modifier "]')?.textContent ?? "";
  it("opens the property editor directly from click, right click and keyboard", async () => {
    const { edits } = render();
    act(() => button("Modifier la propriété État").click());
    await delay();
    expect(document.querySelector('input[aria-label="Nom de la propriété"]')).not.toBeNull();
    expect(settingsText()).toContain("Dupliquer la propriété");
    expect(settingsText()).not.toContain("Renommer");
    act(() =>
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await delay();
    expect(document.querySelector('input[aria-label="Nom de la propriété"]')).toBeNull();
    act(() =>
      button("Modifier la propriété État").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 80 }),
      ),
    );
    await delay();
    expect(settingsText()).toContain("Supprimer la propriété");
    const move = [...document.querySelectorAll<HTMLElement>("button")].find(
      (el) => el.textContent === "Déplacer vers le bas",
    );
    if (move === undefined) throw Error();
    await act(async () => move.click());
    await delay();
    expect(edits).toHaveBeenCalledOnce();
    const rows = [...container.querySelectorAll("[data-property-id]")].map((el) =>
      el.getAttribute("data-property-id"),
    );
    expect(rows.indexOf(reviewId(2))).toBeGreaterThan(rows.indexOf(reviewId(3)));
    act(() =>
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await delay();
    act(() =>
      button("Modifier la propriété État").dispatchEvent(
        new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }),
      ),
    );
    await delay();
    expect(document.querySelector('input[aria-label="Nom de la propriété"]')).not.toBeNull();
  });
  it("opens the property editor without crashing and renames automatically", async () => {
    const { edits } = render();
    act(() => button("Modifier la propriété Texte").click());
    await delay();
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Nom de la propriété"]',
    );
    if (input === null) throw Error();
    act(() => typeInto(input, "Brief"));
    await delay(400);
    expect(edits).toHaveBeenCalledOnce();
    expect(
      container.querySelector('button[aria-label="Modifier la propriété Brief"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("Enregistrer la propriété");
  });
  it("uses the view icon catalog and automatically sets and removes a property icon", async () => {
    const { edits, saves } = render();
    await configure("Texte");
    act(() => button("Changer l’icône de Texte").click());
    await delay();
    const search = document.querySelector<HTMLInputElement>(
      'input[aria-label="Filtrer les icônes"]',
    );
    if (search === null) throw Error();
    act(() => typeInto(search, "zz-nothing"));
    await delay();
    expect(document.body.textContent).toContain("Aucune icône trouvée.");
    act(() => typeInto(search, "ampoule"));
    await delay();
    const choice = document.querySelector<HTMLButtonElement>(
      '[role="option"][aria-label="ampoule"]',
    );
    if (choice === null) throw Error();
    await act(async () => choice.click());
    await delay();
    expect(edits).toHaveBeenCalledOnce();
    expect(
      button("Modifier la propriété Texte").querySelector('[data-icon="lightbulb"]'),
    ).not.toBeNull();
    expect(saves).not.toHaveBeenCalled();
    act(() => button("Changer l’icône de Texte").click());
    await delay();
    const remove = document.querySelector<HTMLButtonElement>(".database-view-icon-picker__remove");
    if (remove === null) throw Error();
    await act(async () => remove.click());
    await delay();
    expect(edits).toHaveBeenCalledTimes(2);
    expect(button("Modifier la propriété Texte").querySelector("[data-icon]")).toBeNull();
    expect(button("Modifier la propriété Texte").textContent).toContain("Aa");
    expect(saves).not.toHaveBeenCalled();
  });
  it("creates and selects an option from the value picker without a save step", async () => {
    const { edits, saves } = render();
    act(() => button("Catégories").click());
    await delay();
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Rechercher ou créer une option"]',
    );
    if (input === null) throw Error();
    act(() => typeInto(input, "Partners"));
    await delay();
    const create = [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Créer « Partners »",
    );
    if (create === undefined) throw Error();
    await act(async () => create.click());
    await delay();
    expect(edits).toHaveBeenCalledOnce();
    expect(saves).toHaveBeenCalledOnce();
    expect(button("Catégories").textContent).toContain("Partners");
    const values = saves.mock.calls[0]?.[0][reviewId(7)];
    expect(values.kind).toBe("multi-select");
    expect(values.optionIds).toHaveLength(2);
  });
  it("removes only the chosen value, keeps the search query and returns its focus", async () => {
    const { edits, saves } = render();
    act(() => button("Catégories").click());
    await delay();
    const search = document.querySelector<HTMLInputElement>(
      'input[aria-label="Rechercher ou créer une option"]',
    );
    if (search === null) throw Error();
    act(() => typeInto(search, "UX"));
    const selected = document.querySelector<HTMLButtonElement>(".entry-choice__token");
    if (selected === null) throw Error();
    await act(async () => selected.click());
    await delay();
    expect(document.activeElement).toBe(search);
    expect(search.value).toBe("UX");
    expect(document.querySelector(".entry-choice__token")).toBeNull();
    expect(button("Catégories").textContent).toBe("Vide");
    expect(saves).toHaveBeenCalledOnce();
    expect(saves.mock.calls[0]?.[0][reviewId(7)]).toEqual({ kind: "multi-select", optionIds: [] });
    expect(edits).not.toHaveBeenCalled();
    act(() => typeInto(search, ""));
    await delay();
    expect(document.querySelectorAll(".entry-choice__option")).toHaveLength(1);
    expect(document.querySelector(".entry-choice__option")?.textContent).toContain(
      "Une option au nom particulièrement long",
    );
  });
  it("keeps a property until impact is confirmed and allows cancelling the change", async () => {
    const { edits } = render(true);
    const requestRetire = async () => {
      await configure("Texte");
      const retire = document.querySelector<HTMLButtonElement>(".property-settings__danger");
      if (retire === null) throw Error();
      await act(async () => retire.click());
      await delay();
    };
    await requestRetire();
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog?.textContent).toContain("conservées pour récupération");
    expect(button("Modifier la propriété Texte")).toBeTruthy();
    const cancel = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (b) => b.textContent === "Annuler",
    );
    if (cancel === undefined) throw Error();
    await act(async () => cancel.click());
    await delay();
    expect(edits).toHaveBeenCalledOnce();
    expect(button("Modifier la propriété Texte")).toBeTruthy();
    await requestRetire();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Confirmer la modification",
    );
    if (confirm === undefined) throw Error();
    await act(async () => confirm.click());
    await delay();
    expect(edits).toHaveBeenCalledTimes(3);
    expect(edits.mock.calls[2]?.[1]).toBe(true);
    expect(container.querySelector('button[aria-label="Modifier la propriété Texte"]')).toBeNull();
  });
});
