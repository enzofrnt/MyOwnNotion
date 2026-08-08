import {
  type DatabaseBlockAttributes,
  type DatabaseRecord,
  readableDatabaseValue,
  type Uuid,
} from "@myownnotion/domain";

export function DatabaseGallery({
  database,
  records,
  onOpenRecord,
}: {
  readonly database: DatabaseBlockAttributes;
  readonly records: readonly DatabaseRecord[];
  readonly onOpenRecord: (recordId: Uuid) => void;
}) {
  return (
    <ul className="database-gallery" aria-label="Database gallery" data-testid="database-gallery">
      {records.map((record) => (
        <li key={record.recordId} data-record-id={record.recordId}>
          <button
            type="button"
            aria-label={`Open record ${record.title || "Untitled record"}`}
            onClick={() => onOpenRecord(record.recordId)}
          >
            <strong>{record.title || "Untitled record"}</strong>
            {database.properties.slice(0, 4).map((property) => (
              <span key={property.propertyId}>
                <b>{property.name}:</b>{" "}
                {readableDatabaseValue(database, record, property) || "Empty"}
              </span>
            ))}
          </button>
        </li>
      ))}
    </ul>
  );
}
