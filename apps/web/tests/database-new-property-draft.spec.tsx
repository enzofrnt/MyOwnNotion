// @vitest-environment jsdom
/**
 * The inline property composer keeps what the owner typed (feature 061).
 *
 * A press outside the composer closes it — that is a dismissal, not a
 * decision to throw the text away. Clearing the draft on every open made a
 * cancelled press lose the name, and the owner had to type it again
 * (.agents/skills/test-quality/lessons.md L-002). Escape and a created property are the only
 * paths that discard it.
 */
import { asUuid, type DatabaseProperty, type DatabaseView } from "@myownnotion/domain";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableView } from "../src/features/databases/table-view.tsx";
import type { DatabaseViewPage } from "../src/services/databases.ts";

const ids = {
  database: asUuid("018f4000-0000-7000-8000-000000000101"),
  revision: asUuid("018f4000-0000-7000-8000-000000000102"),
  title: asUuid("018f4000-0000-7000-8000-000000000103"),
  view: asUuid("018f4000-0000-7000-8000-000000000105"),
};

const properties: DatabaseProperty[] = [
  { id: ids.title, name: "Titre", type: "title", positionKey: "a", state: "active", config: {} },
];
const view: DatabaseView = {
  id: ids.view,
  name: "Tableau",
  type: "table",
  positionKey: "a",
  state: "active",
  properties: [{ propertyId: ids.title, visible: true, positionKey: "a", width: 240 }],
  filter: { mode: "all", criteria: [] },
  sorts: [],
  group: null,
  options: { density: "comfortable", freezeTitle: true },
};
const page: DatabaseViewPage = {
  databaseId: ids.database,
  viewId: ids.view,
  definitionRevisionId: ids.revision,
  generation: 1,
  coverage: "complete",
  availableCount: 0,
  expectedCount: 0,
  rows: [],
};

describe("inline property composer draft", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let onCreateProperty: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onCreateProperty = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function render() {
    act(() =>
      root.render(
        <TableView
          properties={properties}
          view={view}
          page={page}
          onOpenEntry={vi.fn()}
          onResize={vi.fn()}
          onAddProperty={vi.fn()}
          onCreateProperty={onCreateProperty as never}
        />,
      ),
    );
  }

  const addButton = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Ajouter une propriété"]');
  const nameInput = () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Nom de la nouvelle propriété"]');
  const typeButton = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>(".database-new-column__type")].find(
      (button) => button.textContent?.trim() === label,
    );

  function openComposer() {
    const button = addButton();
    if (button === null) throw new Error("the add-property button is not rendered");
    act(() => button.click());
  }

  function typeName(value: string) {
    const input = nameInput();
    if (input === null) throw new Error("the composer is not open");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("keeps the typed name when a press outside closes the composer", () => {
    render();
    openComposer();
    typeName("Notes");
    expect(nameInput()?.value).toBe("Notes");

    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(nameInput(), "a press outside closes the composer").toBeNull();

    openComposer();
    expect(nameInput()?.value, "reopening resumes the draft").toBe("Notes");
  });

  it("clears the draft once the property is created", () => {
    render();
    openComposer();
    typeName("Notes");
    const type = typeButton("Texte");
    if (type === undefined) throw new Error("the Texte type is not offered");
    act(() => type.click());
    expect(onCreateProperty).toHaveBeenCalledWith({ name: "Notes", type: "text", icon: null });
    expect(nameInput()).toBeNull();

    openComposer();
    expect(nameInput()?.value, "a created property does not linger as a draft").toBe("");
  });

  it("treats Escape as the explicit dismissal that discards the draft", () => {
    render();
    openComposer();
    typeName("Notes");
    const input = nameInput();
    if (input === null) throw new Error("the composer is not open");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(nameInput()).toBeNull();

    openComposer();
    expect(nameInput()?.value).toBe("");
  });
});
