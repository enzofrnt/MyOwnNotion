import type { DatabaseEntryProjectionDto, DatabaseProjectionDto } from "@myownnotion/contracts";
import type {
  Database,
  DatabaseEntryRecord,
  DatabaseRecord,
  Transaction,
} from "@myownnotion/database";
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
): Promise<DatabaseProjectionDto[]> {
  const rows = [];
  for (const record of records) {
    rows.push({
      itemId: record.databaseId,
      definitionVersion: record.definitionVersion,
      definition: await resolveDatabaseDefinition(executor, record, content),
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
  const rows = [];
  for (const record of records) {
    rows.push({
      entryItemId: record.entryId,
      databaseId: record.databaseId,
      valueVersion: record.valueVersion,
      values: await resolveDatabaseEntryValues(executor, record, content),
    });
  }
  return rows.sort((left, right) =>
    left.entryItemId.localeCompare(right.entryItemId),
  ) as unknown as DatabaseEntryProjectionDto[];
}
