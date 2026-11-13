import type { DatabaseDto, DatabaseEntryDto } from "@myownnotion/contracts";
import {
  type DatabaseDefinition,
  type DatabaseProperty,
  generateUuidV7,
} from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CreateDatabaseForm } from "../src/features/databases/create-database-form.tsx";
import { DATABASE_COPY, formatDatabaseDecimal } from "../src/features/databases/database-copy.ts";
import { DatabasePage } from "../src/features/databases/database-page.tsx";
import { EntryPanel } from "../src/features/databases/entry-panel.tsx";
import {
  PropertyEditor,
  propertyDraftFromFormData,
  validatePropertyDraft,
} from "../src/features/databases/property-editor.tsx";
import { ValueEditor, validateValueDraft } from "../src/features/databases/value-editor.tsx";

const databaseId = generateUuidV7();
const titlePropertyId = generateUuidV7();
const numberPropertyId = generateUuidV7();
const viewId = generateUuidV7();

const titleProperty: DatabaseProperty = {
  id: titlePropertyId,
  name: "Title",
  type: "title",
  positionKey: "a",
  state: "active",
  config: {},
};
const numberProperty: DatabaseProperty = {
  id: numberPropertyId,
  name: "Estimate",
  type: "number",
  positionKey: "b",
  state: "active",
  config: {},
};
const definition: DatabaseDefinition = {
  format: "myownnotion.database-definition+json",
  formatVersion: 1,
  databaseId,
  properties: [titleProperty, numberProperty],
  views: [
    {
      id: viewId,
      name: "Table",
      type: "table",
      positionKey: "a",
      state: "active",
      properties: [
        { propertyId: titlePropertyId, visible: true, positionKey: "a" },
        { propertyId: numberPropertyId, visible: true, positionKey: "b" },
      ],
      filter: { mode: "all", criteria: [] },
      sorts: [],
      group: null,
      options: { density: "comfortable", freezeTitle: true },
    },
  ],
  taskRoles: null,
};

const database: DatabaseDto = {
  databaseId,
  definitionRevisionId: generateUuidV7(),
  lifecycle: "active",
  name: "Projects",
  definition,
};

describe("database editor surfaces (T022)", () => {
  it("keeps localized copy and arbitrary-size decimal formatting outside canonical values", () => {
    expect(DATABASE_COPY.create.initialTitlePropertyName).toBe("Titre");
    expect(formatDatabaseDecimal("12345678901234567890.50")).toBe("12 345 678 901 234 567 890,50");
  });

  it("renders an explicit page-backed database creation form", () => {
    const markup = renderToStaticMarkup(
      createElement(CreateDatabaseForm, {
        parentItemId: null,
        onCreate: vi.fn(),
      }),
    );
    expect(markup).toContain("Créer une base de données");
    expect(markup).toContain('name="database-name"');
    expect(markup).toContain("Créer la base de données");
  });

  it("validates a property draft without discarding the owner's input", () => {
    const draft = { name: "   ", type: "text" as const };
    const result = validatePropertyDraft(draft);
    expect(result.ok).toBe(false);
    expect(result.draft).toEqual(draft);
    const markup = renderToStaticMarkup(
      createElement(PropertyEditor, {
        draft,
        error: result.ok ? null : result.error,
        onChange: vi.fn(),
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(markup).toContain('value="   "');
    expect(markup).toContain('role="alert"');
  });

  it("submits the current option text even before the controlled draft rerenders", () => {
    const data = new FormData();
    const key = "018f4000-0000-7000-8000-0000000000aa";
    data.set("property-name", "Status");
    data.set("property-type", "select");
    data.set("option-order", key);
    data.set(`option-label-${key}`, "To do");
    data.set(`option-tone-${key}`, "blue");

    expect(
      propertyDraftFromFormData(data, { name: "Status", type: "select", options: [] }),
    ).toEqual({
      name: "Status",
      type: "select",
      options: [{ key, label: "To do", tone: "blue" }],
    });
  });

  it("renders the schema and fixed actions without turning the database into a new item kind", () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [`/notes/${databaseId}`] },
        createElement(DatabasePage, {
          database,
          entries: [],
          onReplaceDefinition: vi.fn(),
          onCreateEntry: vi.fn(),
          onOpenEntry: vi.fn(),
        }),
      ),
    );
    expect(markup).toContain("Contenu de la base de données");
    expect(markup).toContain("Estimate");
    expect(markup).toContain("Ajouter une propriété");
    expect(markup).not.toContain("Nouvel élément");
    expect(markup).toContain("Nouvelle page");
    expect(markup).not.toContain(">Créer<");
    expect(markup).not.toContain("kind=database");
  });

  it("puts the lone add-property label inside its button, not under the filler", () => {
    const tableView = definition.views[0];
    if (tableView === undefined) throw new Error("view fixture missing");
    const singleDefinition: DatabaseDefinition = {
      ...definition,
      properties: [titleProperty],
      views: [
        {
          ...tableView,
          properties: [{ propertyId: titlePropertyId, visible: true, positionKey: "a" }],
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [`/notes/${databaseId}`] },
        createElement(DatabasePage, {
          database: { ...database, definition: singleDefinition },
          entries: [],
          onReplaceDefinition: vi.fn(),
          onCreateEntry: vi.fn(),
          onOpenEntry: vi.fn(),
        }),
      ),
    );
    const button = markup.indexOf('aria-label="Ajouter une propriété"');
    const label = markup.indexOf("database-table-add-property__label");
    expect(button).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(button);
    // The label belongs to the button: the button closes after the label.
    expect(markup.indexOf("</button>", button)).toBeGreaterThan(label);
  });

  it("hides the add-property label when the column header shows the ellipsis", () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [`/notes/${databaseId}`] },
        createElement(DatabasePage, {
          database,
          entries: [],
          onReplaceDefinition: vi.fn(),
          onCreateEntry: vi.fn(),
          onOpenEntry: vi.fn(),
          onOpenViewSettings: vi.fn(),
        }),
      ),
    );
    expect(markup).not.toContain("database-table-add-property__label");
    expect(markup).toContain('aria-label="Options de la vue"');
  });

  it("keeps an ambiguous number draft visible when validation refuses it", () => {
    const result = validateValueDraft(numberProperty, "12,5");
    expect(result).toMatchObject({ ok: false, input: "12,5" });
    const markup = renderToStaticMarkup(
      createElement(ValueEditor, {
        property: numberProperty,
        input: "12,5",
        error: result.ok ? null : result.error,
        onChange: vi.fn(),
      }),
    );
    expect(markup).toContain('value="12,5"');
    expect(markup).toContain("Utilisez un point comme séparateur décimal");
  });

  it("serializes option and relation sets in canonical order without changing the draft", () => {
    const a = generateUuidV7(),
      b = generateUuidV7();
    const ids = [b, a];
    const base = { id: generateUuidV7(), name: "Tags", positionKey: "z", state: "active" as const };
    const choice: DatabaseProperty = {
      ...base,
      type: "multi-select",
      config: {
        options: [a, b].map((id) => ({
          id,
          label: id,
          positionKey: id,
          tone: "neutral" as const,
          state: "active" as const,
        })),
      },
    };
    const result = validateValueDraft(choice, ids);
    expect(result).toMatchObject({
      ok: true,
      value: { kind: "multi-select", optionIds: [...ids].sort() },
    });
    const relation: DatabaseProperty = {
      ...base,
      type: "relation",
      config: { cardinality: "many" },
    };
    expect(validateValueDraft(relation, ids)).toMatchObject({
      ok: true,
      relationTargets: [...ids].sort(),
    });
    expect(ids).toEqual([b, a]);
  });

  it("accepts an intentionally missing date so calendar entries can remain unscheduled", () => {
    const dateProperty: DatabaseProperty = {
      id: generateUuidV7(),
      name: "Due",
      type: "date",
      positionKey: "c",
      state: "active",
      config: { mode: "date" },
    };
    expect(validateValueDraft(dateProperty, "")).toEqual({ ok: true, input: "" });
    expect(validateValueDraft(dateProperty, "2026-11-06|2026-11-08")).toMatchObject({
      ok: true,
      value: { kind: "date", date: "2026-11-06", endDate: "2026-11-08" },
    });
    expect(validateValueDraft(dateProperty, "2026-11-06|")).toMatchObject({
      ok: true,
      value: { kind: "date", date: "2026-11-06" },
    });
    expect(validateValueDraft(dateProperty, "2026-11-06|invalid")).toMatchObject({ ok: false });
  });

  it("renders an entry as one page with structured values and an editorial document", () => {
    const entry: DatabaseEntryDto = {
      databaseId,
      entryId: generateUuidV7(),
      revisionId: generateUuidV7(),
      lifecycle: "active",
      title: "Alpha",
      document: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
      values: { [numberPropertyId]: { kind: "number", decimal: "12.5" } },
      relationTargets: {},
    };
    const markup = renderToStaticMarkup(
      createElement(EntryPanel, {
        entry,
        definition,
        onSaveValues: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(markup).toContain("Alpha");
    expect(markup).toContain("Estimate");
    expect(markup).toContain('value="12.5"');
    expect(markup).toContain("Contenu de la page");
  });
});

describe("contact property types (042)", () => {
  const contact = (type: "url" | "email" | "phone"): DatabaseProperty => ({
    id: generateUuidV7(),
    name: type,
    type,
    positionKey: "d",
    state: "active",
    config: {},
  });

  it("offers URL, e-mail and phone in the property type picker", () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyEditor, {
        draft: { name: "Lien", type: "url" },
        error: null,
        onChange: vi.fn(),
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(markup).toContain(">URL<");
    expect(markup).toContain(">E-mail<");
    expect(markup).toContain(">Téléphone<");
  });

  it("validates each contact format and keeps the draft on refusal", () => {
    expect(validateValueDraft(contact("url"), "https://exemple.fr/a")).toMatchObject({
      ok: true,
      value: { kind: "text", value: "https://exemple.fr/a" },
    });
    expect(validateValueDraft(contact("url"), "exemple.fr")).toMatchObject({
      ok: false,
      input: "exemple.fr",
    });
    expect(validateValueDraft(contact("email"), "nom@exemple.fr")).toMatchObject({
      ok: true,
      value: { kind: "text", value: "nom@exemple.fr" },
    });
    expect(validateValueDraft(contact("email"), "nom")).toMatchObject({ ok: false });
    expect(validateValueDraft(contact("phone"), "+33 6 12 34 56 78")).toMatchObject({
      ok: true,
      value: { kind: "text", value: "+33 6 12 34 56 78" },
    });
    expect(validateValueDraft(contact("phone"), "appelle-moi")).toMatchObject({ ok: false });
    expect(validateValueDraft(contact("url"), "")).toEqual({ ok: true, input: "" });
  });

  it("shows a format example and an explicit error near the field", () => {
    const invalid = validateValueDraft(contact("email"), "sans-arobase");
    const markup = renderToStaticMarkup(
      createElement(ValueEditor, {
        property: contact("email"),
        input: "sans-arobase",
        error: invalid.ok ? null : invalid.error,
        onChange: vi.fn(),
      }),
    );
    expect(markup).toContain('value="sans-arobase"');
    expect(markup).toContain("adresse e-mail");
    const empty = renderToStaticMarkup(
      createElement(ValueEditor, {
        property: contact("url"),
        input: "",
        error: null,
        onChange: vi.fn(),
      }),
    );
    expect(empty).toContain("https://exemple.fr");
  });
});

describe("formula property (045)", () => {
  it("requires an expression and keeps it in the definition", () => {
    expect(validatePropertyDraft({ name: "Total", type: "formula" })).toMatchObject({
      ok: false,
    });
    expect(
      validatePropertyDraft({ name: "Total", type: "formula", expression: 'prop("Prix") * 2' }),
    ).toMatchObject({ ok: true });
  });
});
