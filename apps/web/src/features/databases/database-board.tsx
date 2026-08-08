import {
  type DatabaseBlockAttributes,
  type DatabaseRecord,
  groupDatabaseRecords,
  type Uuid,
} from "@myownnotion/domain";

export function DatabaseBoard({
  database,
  records,
  onOpenRecord,
}: {
  readonly database: DatabaseBlockAttributes;
  readonly records: readonly DatabaseRecord[];
  readonly onOpenRecord: (recordId: Uuid) => void;
}) {
  const groups = groupDatabaseRecords(database, records);
  return (
    <section className="database-board" aria-label="Database board" data-testid="database-board">
      {groups.map((group) => (
        <section
          className="database-board-column"
          aria-labelledby={`database-group-${group.groupId ?? "unassigned"}`}
          key={group.groupId ?? "unassigned"}
        >
          <h4 id={`database-group-${group.groupId ?? "unassigned"}`}>
            {group.label} <span>{group.records.length} records</span>
          </h4>
          <ul>
            {group.records.map((record) => (
              <li key={record.recordId} data-record-id={record.recordId}>
                <button
                  type="button"
                  aria-label={`Open record ${record.title || "Untitled record"}`}
                  onClick={() => onOpenRecord(record.recordId)}
                >
                  {record.title || "Untitled record"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
