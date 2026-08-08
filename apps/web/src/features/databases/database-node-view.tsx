import {
  DATABASE_PROPERTY_TYPES,
  type DatabaseBlockAttributes,
  type DatabasePropertyType,
  projectDatabaseRecords,
  type Uuid,
  validateDatabaseBlockAttributes,
} from "@myownnotion/domain";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import {
  addDatabaseProperty,
  addDatabaseRecord,
  addSelectOption,
  removeDatabaseProperty,
  removeDatabaseRecord,
  removeSelectOption,
  renameDatabaseProperty,
  renameDatabaseRecord,
  renameSelectOption,
  updateDatabaseValue,
  updateDatabaseView,
} from "./database-block.ts";
import { DatabaseBoard } from "./database-board.tsx";
import { DatabaseGallery } from "./database-gallery.tsx";
import { DatabaseTable } from "./database-table.tsx";

const PROPERTY_LABELS: Record<DatabasePropertyType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  date: "Date",
  checkbox: "Checkbox",
  relation: "Relation",
};

export function DatabaseNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const parsed = validateDatabaseBlockAttributes(node.attrs);
  const [propertyName, setPropertyName] = useState("");
  const [propertyType, setPropertyType] = useState<DatabasePropertyType>("text");
  const [recordTitle, setRecordTitle] = useState("");
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});
  const [selectedRecordId, setSelectedRecordId] = useState<Uuid | null>(null);
  const recordEditorRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selectedRecordId !== null) recordEditorRef.current?.focus();
  }, [selectedRecordId]);
  if (!parsed.ok)
    return (
      <NodeViewWrapper className="database-block" data-invalid="true">
        <p role="alert">Database content is incompatible and was left unchanged.</p>
      </NodeViewWrapper>
    );
  const database = parsed.value;
  const apply = (next: DatabaseBlockAttributes) => updateAttributes(next);
  const records = projectDatabaseRecords(database);
  const selectedRecord =
    database.records.find((record) => record.recordId === selectedRecordId) ?? null;

  return (
    <NodeViewWrapper
      className="database-block"
      data-database-id={database.databaseId}
      data-selected={selected ? "true" : "false"}
      data-testid="database-block"
    >
      <div className="database-block-heading">
        <div>
          <h3>Database</h3>
          <output data-testid="database-record-count">
            {records.length} {records.length === 1 ? "record" : "records"}
          </output>
        </div>
        <fieldset className="database-view-switch">
          <legend className="visually-hidden">Database view</legend>
          {(["table", "board", "gallery"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              aria-pressed={database.view.mode === mode}
              onClick={() => apply(updateDatabaseView(database, { mode }))}
            >
              {mode[0]?.toUpperCase()}
              {mode.slice(1)}
            </button>
          ))}
        </fieldset>
      </div>

      <details className="database-schema">
        <summary>Properties</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = addDatabaseProperty(database, propertyName, propertyType);
            apply(next);
            if (next !== database) setPropertyName("");
          }}
        >
          <label>
            Property name
            <input value={propertyName} onChange={(event) => setPropertyName(event.target.value)} />
          </label>
          <label>
            Property type
            <select
              value={propertyType}
              onChange={(event) => setPropertyType(event.target.value as DatabasePropertyType)}
            >
              {DATABASE_PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PROPERTY_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Add property</button>
        </form>
        <ul>
          {database.properties.map((property) => (
            <li key={property.propertyId}>
              <input
                aria-label={`Property name ${property.name}`}
                value={property.name}
                onChange={(event) =>
                  apply(renameDatabaseProperty(database, property.propertyId, event.target.value))
                }
              />
              <span>{PROPERTY_LABELS[property.type]}</span>
              {property.type === "select" ? (
                <div className="database-select-options">
                  <label>
                    New option for {property.name}
                    <input
                      value={optionDrafts[property.propertyId] ?? ""}
                      onChange={(event) =>
                        setOptionDrafts((current) => ({
                          ...current,
                          [property.propertyId]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Add option to ${property.name}`}
                    onClick={() => {
                      const next = addSelectOption(
                        database,
                        property.propertyId,
                        optionDrafts[property.propertyId] ?? "",
                      );
                      apply(next);
                      if (next !== database) {
                        setOptionDrafts((current) => ({
                          ...current,
                          [property.propertyId]: "",
                        }));
                      }
                    }}
                  >
                    Add option
                  </button>
                  {property.options.map((option) => (
                    <span className="database-select-option" key={option.optionId}>
                      <input
                        aria-label={`Option name ${option.name}`}
                        value={option.name}
                        onChange={(event) =>
                          apply(
                            renameSelectOption(
                              database,
                              property.propertyId,
                              option.optionId,
                              event.target.value,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Remove option ${option.name} from ${property.name}`}
                        onClick={() =>
                          apply(removeSelectOption(database, property.propertyId, option.optionId))
                        }
                      >
                        Remove option
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                aria-label={`Remove property ${property.name}`}
                onClick={() => apply(removeDatabaseProperty(database, property.propertyId))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </details>

      <div className="database-controls">
        <label>
          Search records
          <input
            type="search"
            placeholder="Title or property value"
            value={database.view.query}
            onChange={(event) => apply(updateDatabaseView(database, { query: event.target.value }))}
          />
        </label>
        <label>
          Sort records
          <select
            value={database.view.sortPropertyId ?? "title"}
            onChange={(event) =>
              apply(
                updateDatabaseView(database, {
                  sortPropertyId:
                    event.target.value === "title" ? null : (event.target.value as Uuid),
                }),
              )
            }
          >
            <option value="title">Title</option>
            {database.properties.map((property) => (
              <option key={property.propertyId} value={property.propertyId}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort direction
          <select
            value={database.view.sortDirection}
            onChange={(event) =>
              apply(
                updateDatabaseView(database, {
                  sortDirection: event.target.value as "asc" | "desc",
                }),
              )
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        {database.view.mode === "board" ? (
          <label>
            Board group
            <select
              value={database.view.boardGroupPropertyId ?? ""}
              onChange={(event) =>
                apply(
                  updateDatabaseView(database, {
                    boardGroupPropertyId:
                      event.target.value === "" ? null : (event.target.value as Uuid),
                  }),
                )
              }
            >
              <option value="">Unassigned only</option>
              {database.properties
                .filter((property) => property.type === "select")
                .map((property) => (
                  <option key={property.propertyId} value={property.propertyId}>
                    {property.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
      </div>

      <form
        className="database-add-record"
        onSubmit={(event) => {
          event.preventDefault();
          const next = addDatabaseRecord(database, recordTitle);
          apply(next);
          if (next !== database) setRecordTitle("");
        }}
      >
        <label>
          New record title
          <input value={recordTitle} onChange={(event) => setRecordTitle(event.target.value)} />
        </label>
        <button type="submit">Add record</button>
      </form>

      {records.length === 0 ? (
        <p className="empty-state" data-testid="database-empty-state">
          No records match this database view.
        </p>
      ) : database.view.mode === "table" ? (
        <DatabaseTable
          database={database}
          records={records}
          onRenameRecord={(recordId, title) =>
            apply(renameDatabaseRecord(database, recordId, title))
          }
          onUpdateValue={(recordId, propertyId, value) =>
            apply(updateDatabaseValue(database, recordId, propertyId, value))
          }
          onRemoveRecord={(recordId) => apply(removeDatabaseRecord(database, recordId))}
        />
      ) : database.view.mode === "board" ? (
        <DatabaseBoard database={database} records={records} onOpenRecord={setSelectedRecordId} />
      ) : (
        <DatabaseGallery database={database} records={records} onOpenRecord={setSelectedRecordId} />
      )}

      {selectedRecord !== null ? (
        <section
          ref={recordEditorRef}
          className="database-record-editor"
          aria-label={`Record editor ${selectedRecord.title || "Untitled record"}`}
          tabIndex={-1}
        >
          <h4>{selectedRecord.title || "Untitled record"}</h4>
          <button type="button" onClick={() => setSelectedRecordId(null)}>
            Close record editor
          </button>
          <DatabaseTable
            database={database}
            records={[selectedRecord]}
            onRenameRecord={(recordId, title) =>
              apply(renameDatabaseRecord(database, recordId, title))
            }
            onUpdateValue={(recordId, propertyId, value) =>
              apply(updateDatabaseValue(database, recordId, propertyId, value))
            }
            onRemoveRecord={(recordId) => {
              apply(removeDatabaseRecord(database, recordId));
              setSelectedRecordId(null);
            }}
          />
        </section>
      ) : null}
    </NodeViewWrapper>
  );
}
