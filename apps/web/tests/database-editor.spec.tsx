import type { DatabaseDto, DatabaseEntryDto } from "@myownnotion/contracts";
import {
  type DatabaseDefinition,
  type DatabaseProperty,
  generateUuidV7,
} from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
    data.set("property-name", "Status");
    data.set("property-type", "status");
    data.set("property-options", "To do, Done");

    expect(
      propertyDraftFromFormData(data, { name: "Status", type: "status", optionsText: "" }),
    ).toEqual({ name: "Status", type: "status", optionsText: "To do, Done" });
  });

  it("renders the schema and fixed actions without turning the database into a new item kind", () => {
    const markup = renderToStaticMarkup(
      createElement(DatabasePage, {
        database,
        entries: [],
        onReplaceDefinition: vi.fn(),
        onCreateEntry: vi.fn(),
        onOpenEntry: vi.fn(),
      }),
    );
    expect(markup).toContain("Contenu de la base de données");
    expect(markup).toContain("Estimate");
    expect(markup).toContain("Ajouter une propriété");
    expect(markup).toContain("Nouvelle entrée");
    expect(markup).not.toContain("kind=database");
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
