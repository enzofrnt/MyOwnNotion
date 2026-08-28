/** Regenerates committed compatibility fixtures intentionally, never during tests. */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  buildCanonicalExport,
  canonicalExportString,
  type Uuid,
} from "@myownnotion/domain";
import { encodeBackupArchive } from "../../apps/api/src/backup/archive-format.ts";

const id = (suffix: string): Uuid => `018f2b7c-1000-7000-8000-${suffix.padStart(12, "0")}` as Uuid;
const createdAt = "2026-08-18T04:00:00.000Z";
const workspaceId = id("1");
const folderId = id("2");
const pageId = id("3");
const fileId = id("4");
const folderRevisionId = id("11");
const pageRevisionId = id("12");
const fileRevisionId = id("13");
const fileBytes = Buffer.from("MyOwnNotion reference backup file\n", "utf8");
const fileHash = createHash("sha256").update(fileBytes).digest("hex");
const fileDigest = `sha256:${fileHash}`;

const canonical = buildCanonicalExport({
  workspaceId,
  schemaVersion: 1,
  exportedAt: createdAt,
  changeCursor: "6",
  items: [
    {
      id: folderId,
      workspaceId,
      kind: "folder",
      name: "Reference folder",
      icon: "🗂️",
      lifecycle: "active",
      trashedAt: null,
      purgeAfter: null,
      currentRevisionId: folderRevisionId,
      favourite: true,
      offlineIntent: false,
      pageDocument: null,
      file: null,
      placements: [
        {
          id: id("31"),
          workspaceId,
          itemId: folderId,
          itemIsFile: false,
          kind: "hierarchy",
          parentItemId: null,
          positionKey: "Va",
          removedAt: null,
        },
      ],
    },
    {
      id: pageId,
      workspaceId,
      kind: "page",
      name: "Reference page",
      icon: null,
      lifecycle: "active",
      trashedAt: null,
      purgeAfter: null,
      currentRevisionId: pageRevisionId,
      favourite: false,
      offlineIntent: true,
      pageDocument: {
        format: "myownnotion.document+json",
        formatVersion: 1,
        body: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Reference body" }] }],
        },
      },
      file: null,
      placements: [
        {
          id: id("32"),
          workspaceId,
          itemId: pageId,
          itemIsFile: false,
          kind: "hierarchy",
          parentItemId: folderId,
          positionKey: "Vb",
          removedAt: null,
        },
      ],
    },
    {
      id: fileId,
      workspaceId,
      kind: "file",
      name: "reference.txt",
      icon: null,
      lifecycle: "active",
      trashedAt: null,
      purgeAfter: null,
      currentRevisionId: fileRevisionId,
      favourite: false,
      offlineIntent: true,
      pageDocument: null,
      file: {
        mediaType: "text/plain",
        originalName: "reference.txt",
        byteLength: fileBytes.byteLength,
        sha256: fileHash,
      },
      placements: [
        {
          id: id("33"),
          workspaceId,
          itemId: fileId,
          itemIsFile: true,
          kind: "attachment",
          parentItemId: pageId,
          positionKey: "Vc",
          removedAt: null,
        },
      ],
    },
  ],
  relationships: [
    {
      id: id("41"),
      workspaceId,
      sourceItemId: pageId,
      targetItemId: folderId,
      relationType: "mention:reference",
      metadata: { source: "reference-fixture" },
      createdRevisionId: pageRevisionId,
      removedRevisionId: null,
    },
  ],
  revisions: [
    {
      id: folderRevisionId,
      itemId: folderId,
      mutationId: id("21"),
      parentRevisionIds: [],
      acceptedAt: createdAt,
    },
    {
      id: pageRevisionId,
      itemId: pageId,
      mutationId: id("22"),
      parentRevisionIds: [],
      acceptedAt: createdAt,
    },
    {
      id: fileRevisionId,
      itemId: fileId,
      mutationId: id("23"),
      parentRevisionIds: [],
      acceptedAt: createdAt,
    },
  ],
});
const canonicalExport = canonicalExportString(canonical);
const archive = encodeBackupArchive({
  manifest: {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt,
    cursor: canonical.changeCursor,
    applicationVersion: "0.1.0-reference",
    schemaVersion: canonical.schemaVersion,
    recordFormatVersion: 1,
    canonicalExportDigest: `sha256:${createHash("sha256").update(canonicalExport).digest("hex")}`,
    files: [{ digest: fileDigest, byteLength: fileBytes.byteLength }],
    itemCount: canonical.items.length,
    fileCount: 1,
  },
  canonicalExport,
  files: new Map([[fileDigest, fileBytes]]),
});

const outputDirectory = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "tests",
  "fixtures",
  "backups",
);
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(path.join(outputDirectory, "v1-schema1.tar"), archive);
