// @vitest-environment jsdom
import type { DatabaseEntryDto } from "@myownnotion/contracts";
import { previewDefinitionImpact } from "@myownnotion/domain";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntrySchemaImpact } from "../src/features/databases/edit-entry-properties.ts";
import { EntryPanel } from "../src/features/databases/entry-panel.tsx";
import { reviewDefinition, reviewId, reviewPage } from "../src/ui/ui-lab-review-fixtures.ts";
import { present, until } from "./support/until.ts";

function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const nameField = () =>
  present(
    document.querySelector<HTMLInputElement>('input[aria-label="Nom de la propriété"]'),
    "the property name field",
  );
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
  // A picker's name starts with the property and then states the value it
  // shows (WCAG 2.5.3), so tests address it by its prefix instead of pinning
  // the value into the query.
  const picker = (property: string) => {
    const el = document.querySelector<HTMLButtonElement>(`button[aria-label^="${property}"]`);
    if (el === null) throw Error(`Missing picker for ${property}`);
    return el;
  };
  const configure = async (name: string) => {
    act(() => button(`Modifier la propriété ${name}`).click());
    await until(nameField);
  };
  const settingsText = () =>
    document.querySelector('[role="dialog"][aria-label^="Modifier "]')?.textContent ?? "";
  it("opens the property editor directly from click, right click and keyboard", async () => {
    const { edits } = render();
    act(() => button("Modifier la propriété État").click());
    await until(nameField);
    expect(settingsText()).toContain("Dupliquer la propriété");
    expect(settingsText()).not.toContain("Renommer");
    act(() =>
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await vi.waitFor(
      () => expect(document.querySelector('input[aria-label="Nom de la propriété"]')).toBeNull(),
      { timeout: 5_000 },
    );
    act(() =>
      button("Modifier la propriété État").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 80 }),
      ),
    );
    await until(() => expect(settingsText()).toContain("Supprimer la propriété"));
    const move = [...document.querySelectorAll<HTMLElement>("button")].find(
      (el) => el.textContent === "Déplacer vers le bas",
    );
    if (move === undefined) throw Error();
    await act(async () => move.click());
    await until(() => expect(edits).toHaveBeenCalledOnce());
    const rows = [...container.querySelectorAll("[data-property-id]")].map((el) =>
      el.getAttribute("data-property-id"),
    );
    expect(rows.indexOf(reviewId(2))).toBeGreaterThan(rows.indexOf(reviewId(3)));
    act(() =>
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    // The keyboard path must open the editor itself, from a closed state.
    await until(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    act(() =>
      button("Modifier la propriété État").dispatchEvent(
        new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }),
      ),
    );
    await vi.waitFor(
      () =>
        expect(document.querySelector('input[aria-label="Nom de la propriété"]')).not.toBeNull(),
      { timeout: 5_000 },
    );
  });
  it("opens the property editor without crashing and renames automatically", async () => {
    const { edits } = render();
    act(() => button("Modifier la propriété Texte").click());
    const input = await until(nameField);
    act(() => typeInto(input, "Brief"));
    // The rename is debounced; the claim is that it happens without a save
    // step, so wait for the write itself rather than for the debounce length.
    await until(() => expect(edits).toHaveBeenCalledOnce());
    expect(
      container.querySelector('button[aria-label="Modifier la propriété Brief"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("Enregistrer la propriété");
  });
  it("uses the view icon catalog and automatically sets and removes a property icon", async () => {
    const { edits, saves } = render();
    await configure("Texte");
    act(() => button("Changer l’icône de Texte").click());
    const search = await until(() =>
      present(
        document.querySelector<HTMLInputElement>('input[aria-label="Filtrer les icônes"]'),
        "the icon filter",
      ),
    );
    act(() => typeInto(search, "zz-nothing"));
    await until(() => expect(document.body.textContent).toContain("Aucune icône trouvée."));
    act(() => typeInto(search, "ampoule"));
    const choice = await until(() =>
      present(
        document.querySelector<HTMLButtonElement>('[role="option"][aria-label="ampoule"]'),
        "the lightbulb option",
      ),
    );
    await act(async () => choice.click());
    await until(() => expect(edits).toHaveBeenCalledOnce());
    expect(
      button("Modifier la propriété Texte").querySelector('[data-icon="lightbulb"]'),
    ).not.toBeNull();
    expect(saves).not.toHaveBeenCalled();
    act(() => button("Changer l’icône de Texte").click());
    const remove = await until(() =>
      present(
        document.querySelector<HTMLButtonElement>(".database-view-icon-picker__remove"),
        "the remove-icon action",
      ),
    );
    await act(async () => remove.click());
    await until(() => expect(edits).toHaveBeenCalledTimes(2));
    expect(
      button("Modifier la propriété Texte").querySelector('[data-icon="type"]'),
    ).not.toBeNull();
    expect(button("Modifier la propriété Texte").textContent).not.toContain("Aa");
    expect(saves).not.toHaveBeenCalled();
  });
  it("creates and selects an option from the value picker without a save step", async () => {
    const { edits, saves } = render();
    act(() => picker("Catégories").click());
    const input = await until(() =>
      present(
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Rechercher ou créer une option"]',
        ),
        "the option search",
      ),
    );
    act(() => typeInto(input, "Partners"));
    const create = await until(() =>
      present(
        [...document.querySelectorAll("button")].find(
          (el) => el.textContent === "Créer « Partners »",
        ),
        "the create-option action",
      ),
    );
    await act(async () => create.click());
    await until(() => expect(saves).toHaveBeenCalledOnce());
    expect(edits).toHaveBeenCalledOnce();
    expect(picker("Catégories").textContent).toContain("Partners");
    const values = saves.mock.calls[0]?.[0][reviewId(7)];
    expect(values.kind).toBe("multi-select");
    expect(values.optionIds).toHaveLength(2);
  });
  it("removes only the chosen value, keeps the search query and returns its focus", async () => {
    const { edits, saves } = render();
    act(() => picker("Catégories").click());
    const search = await until(() =>
      present(
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Rechercher ou créer une option"]',
        ),
        "the option search",
      ),
    );
    act(() => typeInto(search, "UX"));
    const selected = document.querySelector<HTMLButtonElement>(".entry-choice__token");
    if (selected === null) throw Error();
    await act(async () => selected.click());
    await until(() => expect(saves).toHaveBeenCalledOnce());
    // Focus is handed back after the removal re-renders the token list.
    await until(() => expect(document.activeElement).toBe(search));
    expect(search.value).toBe("UX");
    expect(document.querySelector(".entry-choice__token")).toBeNull();
    expect(picker("Catégories").textContent).toBe("Vide");
    expect(saves).toHaveBeenCalledOnce();
    expect(saves.mock.calls[0]?.[0][reviewId(7)]).toEqual({ kind: "multi-select", optionIds: [] });
    expect(edits).not.toHaveBeenCalled();
    act(() => typeInto(search, ""));
    await until(() => expect(document.querySelectorAll(".entry-choice__option")).toHaveLength(1));
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
      await until(() =>
        present(document.querySelector('[role="dialog"][aria-modal="true"]'), "the impact dialog"),
      );
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
    await until(() =>
      expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull(),
    );
    expect(edits).toHaveBeenCalledOnce();
    expect(button("Modifier la propriété Texte")).toBeTruthy();
    await requestRetire();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Confirmer la modification",
    );
    if (confirm === undefined) throw Error();
    await act(async () => confirm.click());
    await until(() => expect(edits).toHaveBeenCalledTimes(3));
    expect(edits.mock.calls[2]?.[1]).toBe(true);
    // The confirmed retirement re-renders the list after the edit resolves.
    await until(() =>
      expect(
        container.querySelector('button[aria-label="Modifier la propriété Texte"]'),
      ).toBeNull(),
    );
  });
});
