import { createHash } from "node:crypto";
import type {
  DatabaseDefinition,
  DatabaseView,
  NonRelationPropertyValue,
  PageDocument,
  RelationTargets,
  Uuid,
} from "@myownnotion/domain";
import type { ImportSnapshot } from "./source.ts";
export function importId(namespace: string, value: string): Uuid {
  const bytes = createHash("sha256")
    .update(`myownnotion.import.v1\0${namespace}\0${value}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 15) | 80;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Uuid;
}
export interface ImportIssue {
  code: string;
  sourcePath: string;
  detail?: string;
  blocking?: boolean;
}
export interface ImportPage {
  id: Uuid;
  path: string;
  title: string;
  parentId: Uuid;
  document: PageDocument;
  databaseId?: Uuid;
  sourceId?: Uuid;
  icon?: string;
  positionKey: string;
  values?: Record<Uuid, NonRelationPropertyValue>;
  relationTargets?: RelationTargets;
}
export interface ImportFile {
  id: Uuid;
  path: string;
  name: string;
  parentId: Uuid;
  mediaType: string;
  original: boolean;
}
export interface ImportFolder {
  id: Uuid;
  name: string;
  parentId: Uuid | null;
}
export interface ImportDataSource {
  id: Uuid;
  name: string;
  titlePropertyId: Uuid;
  initialViewId: Uuid;
  definition: DatabaseDefinition;
}
export interface ImportDatabase {
  id: Uuid;
  parentId: Uuid;
  path: string;
  name: string;
  icon?: string;
  sources: ImportDataSource[];
  positionKey: string;
  views: Array<DatabaseView & { sourceId: Uuid }>;
}
export interface ImportReport {
  adapter: "notion-api";
  importId: Uuid;
  snapshotDigest: string;
  totals: {
    pages: number;
    databases: number;
    sources: number;
    memberships: number;
    attachments: number;
    originals: number;
    sourceBytes: number;
    issues: number;
  };
  identities: Array<{ sourceId: string; targetId: Uuid; kind: string }>;
  issues: ImportIssue[];
}
export interface ImportPlan {
  version: 2;
  excludedDatabaseIds?: readonly string[];
  id: Uuid;
  rootId: Uuid;
  fingerprint: string;
  snapshot: ImportSnapshot;
  folders: ImportFolder[];
  pages: ImportPage[];
  files: ImportFile[];
  databases: ImportDatabase[];
  report: ImportReport;
}
