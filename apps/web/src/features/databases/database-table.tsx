import type {
  DatabaseBlockAttributes,
  DatabaseProperty,
  DatabaseRecord,
  Uuid,
} from "@myownnotion/domain";

function currentValue(record: DatabaseRecord, propertyId: Uuid) {
  return record.values.find((value) => value.propertyId === propertyId)?.value;
}

export function DatabaseCell({
  database,
  record,
  property,
  onChange,
}: {
  readonly database: DatabaseBlockAttributes;
  readonly record: DatabaseRecord;
  readonly property: DatabaseProperty;
  readonly onChange: (value: string | boolean | readonly Uuid[]) => void;
}) {
  const value = currentValue(record, property.propertyId);
  const label = `${property.name} for ${record.title || "Untitled record"}`;
  switch (property.type) {
    case "text":
      return (
        <input
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          step="any"
          aria-label={label}
          value={typeof value === "number" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "select":
      return (
        <select
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Unassigned</option>
          {property.options.map((option) => (
            <option key={option.optionId} value={option.optionId}>
              {option.name}
            </option>
          ))}
        </select>
      );
    case "date":
      return (
        <input
          type="date"
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          aria-label={label}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      );
    case "relation": {
      const selected = Array.isArray(value)
        ? value.filter((entry): entry is Uuid => typeof entry === "string")
        : [];
      const availableIds = new Set(database.records.map((candidate) => candidate.recordId));
      const unavailable = selected.filter((targetId) => !availableIds.has(targetId));
      return (
        <select
          multiple
          aria-label={label}
          value={selected}
          onChange={(event) =>
            onChange(Array.from(event.target.selectedOptions, (option) => option.value as Uuid))
          }
        >
          {database.records.map((candidate) => (
            <option key={candidate.recordId} value={candidate.recordId}>
              {candidate.title || "Untitled record"}
            </option>
          ))}
          {unavailable.length > 0 ? (
            <optgroup label="Unavailable records">
              {unavailable.map((targetId) => (
                <option key={targetId} value={targetId} data-unavailable="true">
                  Unavailable record ({targetId.slice(0, 8)})
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      );
    }
  }
}

export function DatabaseTable({
  database,
  records,
  onRenameRecord,
  onUpdateValue,
  onRemoveRecord,
}: {
  readonly database: DatabaseBlockAttributes;
  readonly records: readonly DatabaseRecord[];
  readonly onRenameRecord: (recordId: Uuid, title: string) => void;
  readonly onUpdateValue: (
    recordId: Uuid,
    propertyId: Uuid,
    value: string | boolean | readonly Uuid[],
  ) => void;
  readonly onRemoveRecord: (recordId: Uuid) => void;
}) {
  return (
    <div className="database-table-scroll" data-testid="database-table">
      <table>
        <thead>
          <tr>
            <th scope="col">Title</th>
            {database.properties.map((property) => (
              <th scope="col" key={property.propertyId}>
                {property.name}
              </th>
            ))}
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.recordId} data-record-id={record.recordId}>
              <td>
                <input
                  aria-label={`Record title ${record.title || "Untitled record"}`}
                  value={record.title}
                  onChange={(event) => onRenameRecord(record.recordId, event.target.value)}
                />
              </td>
              {database.properties.map((property) => (
                <td key={property.propertyId}>
                  <DatabaseCell
                    database={database}
                    record={record}
                    property={property}
                    onChange={(value) => onUpdateValue(record.recordId, property.propertyId, value)}
                  />
                </td>
              ))}
              <td>
                <button
                  type="button"
                  aria-label={`Remove record ${record.title || "Untitled record"}`}
                  onClick={() => onRemoveRecord(record.recordId)}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
