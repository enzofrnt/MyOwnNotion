import type { DatabaseDto, DatabaseEntryDto } from "@myownnotion/contracts";
import type {
  DatabaseDefinition,
  DatabaseProperty,
  DefinitionImpact,
  Uuid,
} from "@myownnotion/domain";
import { type FormEvent, useState } from "react";
import {
  type DatabasePropertyDraft,
  PropertyEditor,
  propertyFromDraft,
  validatePropertyDraft,
} from "./property-editor.tsx";

const EMPTY_PROPERTY_DRAFT: DatabasePropertyDraft = { name: "", type: "text" };

function displayValue(entry: DatabaseEntryDto, property: DatabaseProperty): string {
  if (property.type === "title") return entry.title;
  if (property.type === "relation") {
    const targets = entry.relationTargets[property.id] ?? [];
    return targets.length === 0
      ? "—"
      : `${targets.length} linked page${targets.length === 1 ? "" : "s"}`;
  }
  const value = entry.values[property.id];
  if (value === undefined) return "—";
  switch (value.kind) {
    case "text":
      return value.value || "—";
    case "number":
      return value.decimal;
    case "date":
      return value.date;
    case "instant":
      return value.instant;
    case "checkbox":
      return value.checked ? "Yes" : "No";
    case "status":
    case "select":
      return property.type === "status" || property.type === "select"
        ? (property.config.options.find((option) => option.id === value.optionId)?.label ??
            "Unknown option")
        : "Unknown option";
    case "multi-select":
      return property.type === "multi-select"
        ? value.optionIds
            .map(
              (optionId) => property.config.options.find((option) => option.id === optionId)?.label,
            )
            .filter(Boolean)
            .join(", ") || "—"
        : "—";
  }
}

export interface DefinitionConfirmation {
  readonly digest: string;
  readonly decision: "preserve-incompatible" | "discard-confirmed";
}

export function DatabasePage({
  database,
  entries,
  onReplaceDefinition,
  onPreviewDefinitionImpact,
  onCreateEntry,
  onOpenEntry,
}: {
  readonly database: DatabaseDto;
  readonly entries: readonly DatabaseEntryDto[];
  readonly onReplaceDefinition: (
    definition: DatabaseDefinition,
    confirmation?: DefinitionConfirmation,
  ) => void | Promise<void>;
  readonly onPreviewDefinitionImpact?: (
    definition: DatabaseDefinition,
  ) => DefinitionImpact | null | Promise<DefinitionImpact | null>;
  readonly onCreateEntry: (title: string) => void | Promise<void>;
  readonly onOpenEntry: (entryId: Uuid) => void;
}) {
  const [editingProperty, setEditingProperty] = useState(false);
  const [propertyDraft, setPropertyDraft] = useState<DatabasePropertyDraft>(EMPTY_PROPERTY_DRAFT);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [entryTitle, setEntryTitle] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [pendingDefinition, setPendingDefinition] = useState<DatabaseDefinition | null>(null);
  const [impact, setImpact] = useState<DefinitionImpact | null>(null);

  // Contract schemas intentionally expose JSON strings, while the domain
  // brands UUIDs once validation has crossed the boundary. DatabaseDto has
  // already passed that contract validation, so the UI works on the branded
  // shape from here onward.
  const definition = database.definition as unknown as DatabaseDefinition;
  const activeProperties = definition.properties.filter((property) => property.state === "active");

  const addProperty = (): void => {
    const result = validatePropertyDraft(propertyDraft);
    if (!result.ok) {
      setPropertyError(result.error);
      return;
    }
    const property = propertyFromDraft(
      result,
      `property-${String(definition.properties.length).padStart(6, "0")}`,
    );
    const candidate: DatabaseDefinition = {
      ...definition,
      properties: [...definition.properties, property],
      views: definition.views.map((view) => ({
        ...view,
        properties: [
          ...view.properties,
          { propertyId: property.id, visible: true, positionKey: property.positionKey },
        ],
      })),
    };
    setSavingProperty(true);
    void Promise.resolve(onReplaceDefinition(candidate))
      .then(() => {
        setPropertyDraft(EMPTY_PROPERTY_DRAFT);
        setPropertyError(null);
        setEditingProperty(false);
        setSavingProperty(false);
      })
      .catch(() => {
        setPropertyError("The property could not be saved. Your draft is still here.");
        setSavingProperty(false);
      });
  };

  const retireProperty = async (propertyId: Uuid): Promise<void> => {
    const candidate: DatabaseDefinition = {
      ...definition,
      properties: definition.properties.map((property) =>
        property.id === propertyId ? { ...property, state: "retired" as const } : property,
      ),
      views: definition.views.map((view) => ({
        ...view,
        properties: view.properties.map((presentation) =>
          presentation.propertyId === propertyId
            ? { ...presentation, visible: false }
            : presentation,
        ),
      })),
    };
    const preview = await onPreviewDefinitionImpact?.(candidate);
    if (preview?.destructive) {
      setPendingDefinition(candidate);
      setImpact(preview);
      return;
    }
    await onReplaceDefinition(candidate);
  };

  const createEntry = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const title = entryTitle.trim();
    if (title.length === 0) {
      setEntryError("Give the page a title.");
      return;
    }
    setEntryError(null);
    try {
      await onCreateEntry(title);
      setEntryTitle("");
    } catch {
      setEntryError("The entry could not be created. Your title is still here.");
    }
  };

  return (
    <section className="database-page" aria-labelledby={`database-heading-${database.databaseId}`}>
      <header className="database-page__header">
        <div>
          <p className="muted">Database · page</p>
          <h2 id={`database-heading-${database.databaseId}`}>{database.name}</h2>
        </div>
        <button type="button" disabled={savingProperty} onClick={() => setEditingProperty(true)}>
          Add property
        </button>
      </header>

      {editingProperty ? (
        <PropertyEditor
          draft={propertyDraft}
          error={propertyError}
          onChange={(draft) => {
            setPropertyDraft(draft);
            setPropertyError(null);
          }}
          onSubmit={addProperty}
          onCancel={() => setEditingProperty(false)}
          submitting={savingProperty}
        />
      ) : null}

      <section className="database-schema" aria-labelledby="database-schema-heading">
        <h3 id="database-schema-heading">Properties</h3>
        <ul>
          {activeProperties.map((property) => (
            <li key={property.id}>
              <span>{property.name}</span>
              <span className="muted">{property.type}</span>
              {property.type !== "title" ? (
                <button
                  type="button"
                  className="link"
                  onClick={() => void retireProperty(property.id)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {impact !== null && pendingDefinition !== null ? (
        <section className="database-impact" role="alertdialog" aria-label="Confirm schema change">
          <h3>This schema change affects saved values</h3>
          <p>
            {impact.affectedValueCount} value{impact.affectedValueCount === 1 ? "" : "s"} across{" "}
            {impact.affectedEntryCount} entr{impact.affectedEntryCount === 1 ? "y" : "ies"}.
          </p>
          <div className="field-row">
            <button
              type="button"
              onClick={() => {
                void onReplaceDefinition(pendingDefinition, {
                  digest: impact.impactDigest,
                  decision: "preserve-incompatible",
                });
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              Preserve incompatible values
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                void onReplaceDefinition(pendingDefinition, {
                  digest: impact.impactDigest,
                  decision: "discard-confirmed",
                });
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              Discard affected values
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <form className="database-entry-create" onSubmit={createEntry}>
        <label htmlFor={`new-entry-${database.databaseId}`}>New entry</label>
        <div className="field-row">
          <input
            id={`new-entry-${database.databaseId}`}
            value={entryTitle}
            placeholder="Untitled page"
            onChange={(event) => setEntryTitle(event.target.value)}
          />
          <button type="submit">New entry</button>
        </div>
        {entryError !== null ? <p role="alert">{entryError}</p> : null}
      </form>

      <div className="database-table-scroll">
        <table className="database-table" aria-label="Database entries">
          <thead>
            <tr>
              {activeProperties.map((property) => (
                <th key={property.id} scope="col">
                  {property.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={activeProperties.length || 1}>No entries yet.</td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.entryId}>
                  {activeProperties.map((property) => (
                    <td key={property.id}>
                      {property.type === "title" ? (
                        <button
                          type="button"
                          className="link"
                          onClick={() => onOpenEntry(entry.entryId as Uuid)}
                        >
                          {entry.title}
                        </button>
                      ) : (
                        displayValue(entry, property)
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
