import { createHash } from "node:crypto";
import type {
  DatabaseDefinition,
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
export interface ImportLink {
  sourcePath: string;
  sourceTarget: string;
  targetId: Uuid | null;
  status: "resolved" | "external" | "missing" | "ambiguous" | "unsafe";
}
export interface ImportPage {
  id: Uuid;
  path: string;
  title: string;
  parentId: Uuid;
  document: PageDocument;
  properties: Record<string, unknown>;
  databaseId?: Uuid;
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
export interface ImportDatabase {
  id: Uuid;
  hostPageId: Uuid;
  path: string;
  name: string;
  titlePropertyId: Uuid;
  initialViewId: Uuid;
  embeddingId: Uuid;
  definition: DatabaseDefinition;
  memberIds: Uuid[];
}
export interface ImportReport {
  adapter: "notion" | "obsidian";
  snapshotDigest: string;
  importId: Uuid;
  totals: {
    sourceFiles: number;
    sourceBytes: number;
    pages: number;
    folders: number;
    attachments: number;
    originals: number;
    databases: number;
    memberships: number;
    links: number;
    issues: number;
  };
  files: Array<{ path: string; bytes: number; sha256: string; outcome: string; canonicalId: Uuid }>;
  links: ImportLink[];
  properties: Array<{ sourcePath: string; name: string; representation: string }>;
  databases: Array<{
    path: string;
    id: Uuid;
    hostPageId: Uuid;
    members: number;
    presentation: "exported-table" | "default-table";
    missing: string[];
  }>;
  issues: ImportIssue[];
}
export interface ImportPlan {
  version: 1;
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
