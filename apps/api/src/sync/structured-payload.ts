import type { DatabaseEntryProjectionDto, DatabaseProjectionDto } from "@myownnotion/contracts";
import type {
  Database,
  DatabaseEntryRecord,
  DatabaseRecord,
  Transaction,
} from "@myownnotion/database";
import {
  readCurrentDatabasePresentation,
  readDatabasePresentationRecord,
  readDatabaseRecordBySourceId,
} from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import {
  resolveDatabaseDefinition,
  resolveDatabaseEntryValues,
} from "../security/content-resolution.ts";
import type { ProtectedContent } from "../security/protected-content.ts";

type Executor = Database | Transaction;

export async function resolveDatabaseProjections(
  executor: Executor,
  records: readonly DatabaseRecord[],
  content: ProtectedContent | undefined,
  linkedContainerIds: readonly Uuid[] = [],
): Promise<DatabaseProjectionDto[]> {
  const rows = [];
  for (const record of records) {
    const presentationRecord = await readDatabasePresentationRecord(executor, record.databaseId);
    const presentation = await readCurrentDatabasePresentation(
      executor,
      record.databaseId,
      (revisionId) => content?.readRevisionSnapshot(executor, revisionId) ?? Promise.resolve(null),
    );
    rows.push({
      itemId: record.databaseId,
      sourceId: record.sourceId,
      definitionVersion: record.definitionVersion,
      ...(record.definitionRevisionId === null
        ? {}
        : { definitionRevisionId: record.definitionRevisionId }),
      definition: await resolveDatabaseDefinition(executor, record, content),
      ...(presentationRecord === null
        ? {}
        : {
            presentationVersion: presentationRecord.presentationVersion,
            presentationRevisionId: presentationRecord.presentationRevisionId,
          }),
      ...(presentation === null ? {} : { presentation }),
    });
  }
  for (const containerItemId of linkedContainerIds) {
    const presentationRecord = await readDatabasePresentationRecord(executor, containerItemId);
    const presentation = await readCurrentDatabasePresentation(
      executor,
      containerItemId,
      (revisionId) => content?.readRevisionSnapshot(executor, revisionId) ?? Promise.resolve(null),
    );
    const sourceId = presentation?.views.find((view) => view.state === "active")?.sourceId;
    if (presentationRecord === null || presentation === null || sourceId === undefined) continue;
    const source = await readDatabaseRecordBySourceId(executor, sourceId);
    if (source === null) continue;
    rows.push({
      itemId: containerItemId,
      definitionVersion: source.definitionVersion,
      definitionRevisionId:
        source.definitionRevisionId ?? presentationRecord.presentationRevisionId,
      definition: await resolveDatabaseDefinition(executor, source, content),
      presentationVersion: presentationRecord.presentationVersion,
      presentationRevisionId: presentationRecord.presentationRevisionId,
      presentation,
    });
  }
  return rows.sort((left, right) =>
    left.itemId.localeCompare(right.itemId),
  ) as unknown as DatabaseProjectionDto[];
}

export async function resolveDatabaseEntryProjections(
  executor: Executor,
  records: readonly DatabaseEntryRecord[],
  content: ProtectedContent | undefined,
): Promise<DatabaseEntryProjectionDto[]> {
  const sealed = await content?.readDatabaseEntryValuesMany(executor, records);
  const rows = [];
  for (const record of records) {
    rows.push({
      entryItemId: record.entryId,
      databaseId: record.databaseId,
      sourceId: record.sourceId,
      valueVersion: record.valueVersion,
      values:
        sealed?.get(record.entryId) ??
        (await resolveDatabaseEntryValues(executor, record, content)),
    });
  }
  return rows.sort((left, right) =>
    left.entryItemId.localeCompare(right.entryItemId),
  ) as unknown as DatabaseEntryProjectionDto[];
}
