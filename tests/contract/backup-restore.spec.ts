import {
  type CanonicalExportManifest,
  canonicalExportString,
  canonicalRecoveryString,
  type Uuid,
  validateCanonicalExport,
  validateCanonicalRecovery,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const WORKSPACE_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd1" as Uuid;
const PAGE_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd2" as Uuid;
const FILE_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd3" as Uuid;
const PAGE_REVISION_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd4" as Uuid;
const FILE_REVISION_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd5" as Uuid;
const CONTENT_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd6" as Uuid;
const PAGE_PLACEMENT_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd7" as Uuid;
const FILE_PLACEMENT_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd8" as Uuid;
const RELATIONSHIP_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd9" as Uuid;
const PAGE_MUTATION_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dda" as Uuid;
const FILE_MUTATION_ID = "019c3e8e-3140-7a75-af40-7a4b74df0ddb" as Uuid;

type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends ReadonlyArray<infer Entry>
    ? Mutable<Entry>[]
    : T extends object
      ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
      : T;
type MutableManifest = Mutable<CanonicalExportManifest>;

function recoveredFile(manifest: MutableManifest) {
  const item = manifest.items.find((candidate) => candidate.id === FILE_ID);
  if (item?.file === null || item?.file === undefined) throw new Error("file fixture is missing");
  return item.file;
}

function recoveredFilePlacement(manifest: MutableManifest) {
  const placement = manifest.items
    .find((candidate) => candidate.id === FILE_ID)
    ?.placements.find((candidate) => candidate.id === FILE_PLACEMENT_ID);
  if (placement === undefined) throw new Error("file placement fixture is missing");
  return placement;
}

function recoveredRelationship(manifest: MutableManifest) {
  const relationship = manifest.relationships.find((candidate) => candidate.id === RELATIONSHIP_ID);
  if (relationship === undefined) throw new Error("relationship fixture is missing");
  return relationship;
}

function recoveredPageDocument(manifest: MutableManifest) {
  const document = manifest.items.find((candidate) => candidate.id === PAGE_ID)?.pageDocument;
  if (document === null || document === undefined) throw new Error("page fixture is missing");
  return document;
}

function sourceManifest(): CanonicalExportManifest {
  return {
    format: "myownnotion.export+json",
    formatVersion: 1,
    workspaceId: WORKSPACE_ID,
    schemaVersion: 1,
    exportedAt: "2026-08-08T00:00:00.000Z",
    changeCursor: "42",
    items: [
      {
        id: PAGE_ID,
        workspaceId: WORKSPACE_ID,
        kind: "page",
        name: "Recovery source",
        lifecycle: "active",
        trashedAt: null,
        purgeAfter: null,
        currentRevisionId: PAGE_REVISION_ID,
        pageDocument: {
          format: "myownnotion.document+json",
          formatVersion: 1,
          body: { recovery: "exact" },
        },
        file: null,
        placements: [
          {
            id: PAGE_PLACEMENT_ID,
            workspaceId: WORKSPACE_ID,
            itemId: PAGE_ID,
            itemKind: "page",
            kind: "hierarchy",
            parentItemId: null,
            positionKey: "a",
            removedAt: null,
          },
        ],
      },
      {
        id: FILE_ID,
        workspaceId: WORKSPACE_ID,
        kind: "file",
        name: "recovery.bin",
        lifecycle: "active",
        trashedAt: null,
        purgeAfter: null,
        currentRevisionId: FILE_REVISION_ID,
        pageDocument: null,
        file: {
          contentId: CONTENT_ID,
          revisionId: FILE_REVISION_ID,
          mediaType: "application/octet-stream",
          originalName: "recovery.bin",
          byteLength: 42,
          sha256: "a".repeat(64),
        },
        placements: [
          {
            id: FILE_PLACEMENT_ID,
            workspaceId: WORKSPACE_ID,
            itemId: FILE_ID,
            itemKind: "file",
            kind: "attachment",
            parentItemId: PAGE_ID,
            positionKey: "b",
            removedAt: null,
          },
        ],
      },
    ],
    relationships: [
      {
        id: RELATIONSHIP_ID,
        workspaceId: WORKSPACE_ID,
        sourceItemId: PAGE_ID,
        targetItemId: FILE_ID,
        relationType: "attachment:contains",
        metadata: {},
        createdRevisionId: PAGE_REVISION_ID,
        removedRevisionId: null,
      },
    ],
    revisions: [
      {
        id: PAGE_REVISION_ID,
        itemId: PAGE_ID,
        mutationId: PAGE_MUTATION_ID,
        parentRevisionIds: [],
        acceptedAt: "2026-08-08T00:00:00.000Z",
      },
      {
        id: FILE_REVISION_ID,
        itemId: FILE_ID,
        mutationId: FILE_MUTATION_ID,
        parentRevisionIds: [],
        acceptedAt: "2026-08-08T00:00:01.000Z",
      },
    ],
    counts: {
      items: 2,
      activeItems: 2,
      trashedItems: 0,
      placements: 2,
      relationships: 1,
      revisions: 2,
    },
  };
}

describe("clean-host canonical recovery comparison", () => {
  it("keeps legacy version-1 file exports readable while new exports carry exact identities", () => {
    const legacy = structuredClone(sourceManifest()) as unknown as MutableManifest;
    delete recoveredFile(legacy).contentId;
    delete recoveredFile(legacy).revisionId;
    expect(validateCanonicalExport(legacy)).toEqual([]);
  });

  it("compares source, backup, empty target, restored target, and restarted target exactly", () => {
    const source = sourceManifest();
    const backupArtifact = canonicalExportString(source);
    const emptyTarget: CanonicalExportManifest | null = null;
    expect(emptyTarget).toBeNull();

    const restored = JSON.parse(backupArtifact) as MutableManifest;
    restored.exportedAt = "2026-08-09T00:00:00.000Z";
    const restarted = JSON.parse(JSON.stringify(restored)) as CanonicalExportManifest;
    for (const observed of [restored, restarted]) {
      expect(validateCanonicalRecovery(source, observed)).toEqual([]);
      expect(canonicalRecoveryString(observed)).toBe(canonicalRecoveryString(source));
      expect(observed.items.find((item) => item.id === FILE_ID)?.file).toMatchObject({
        contentId: CONTENT_ID,
        revisionId: FILE_REVISION_ID,
        byteLength: 42,
        sha256: "a".repeat(64),
      });
    }
  });

  it.each([
    [
      "file digest",
      (manifest: MutableManifest) => (recoveredFile(manifest).sha256 = "b".repeat(64)),
    ],
    [
      "content identity",
      (manifest: MutableManifest) => (recoveredFile(manifest).contentId = PAGE_ID),
    ],
    [
      "file revision",
      (manifest: MutableManifest) => (recoveredFile(manifest).revisionId = PAGE_REVISION_ID),
    ],
    [
      "placement identity",
      (manifest: MutableManifest) => (recoveredFilePlacement(manifest).id = PAGE_PLACEMENT_ID),
    ],
    [
      "relationship identity",
      (manifest: MutableManifest) => (recoveredRelationship(manifest).id = FILE_ID),
    ],
    [
      "page document",
      (manifest: MutableManifest) =>
        (recoveredPageDocument(manifest).body = { recovery: "changed" }),
    ],
  ] as const)("rejects a changed %s", (_label, mutate) => {
    const source = sourceManifest();
    const recovered = structuredClone(source) as unknown as MutableManifest;
    mutate(recovered);
    expect(validateCanonicalRecovery(source, recovered)).toContainEqual(
      expect.objectContaining({ code: "recovery.canonical-mismatch" }),
    );
  });
});
