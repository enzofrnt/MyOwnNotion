import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { ContentStore, FilesystemBlobStore, PartialUploadStore } from "@myownnotion/blob-store";
import {
  getOrCreateWorkspace,
  readCurrentDatabaseDefinition,
  readDatabaseRecord,
  readDatabaseRelationTargets,
  submitMutation,
} from "@myownnotion/database";
import {
  type CanonicalExportManifest,
  type DatabaseDefinition,
  generateUuidV7,
  type MutationCommand,
  type Uuid,
  validateCanonicalExport,
} from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  openBackupArchive,
  sealBackupArchiveStream,
} from "../../../apps/api/src/backup/archive-crypto.ts";
import { inspectBackupArchive } from "../../../apps/api/src/backup/archive-format.ts";
import { BackupService } from "../../../apps/api/src/backup/backup-service.ts";
import { createDatabaseRestoreTarget } from "../../../apps/api/src/backup/database-restore-target.ts";
import type { BackupDestination } from "../../../apps/api/src/backup/destinations/destination.ts";
import { createDisposableWorkspace } from "../../../apps/api/src/backup/disposable-workspace.ts";
import { applyArchive } from "../../../apps/api/src/backup/restore-service.ts";
import type { AppContext } from "../../../apps/api/src/context.ts";
import { buildManifest } from "../../../apps/api/src/routes/export.ts";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);
afterAll(async () => {
  await context?.close();
});

async function submit(command: MutationCommand) {
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: command.type,
    command,
  });
  expect(outcome.result.status, JSON.stringify(outcome.result)).toBe("accepted");
  return outcome;
}
async function owner() {
  const id = generateUuidV7();
  await submit({
    type: "database.create",
    id,
    name: "Recovery fixture",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Table",
  });
  const record = await readDatabaseRecord(context.handle.db, id);
  const definition = await readCurrentDatabaseDefinition(context.handle.db, id);
  if (!record?.definitionRevisionId || !definition) throw new Error("Missing source fixture");
  return { ...record, definitionRevisionId: record.definitionRevisionId, definition };
}

describe("057 canonical relation recovery", () => {
  it.each(["owned", "secondary"] as const)(
    "preserves source config and historical link identities through encrypted backup/restore (%s target source)",
    async (sourceKind) => {
      const origin = await owner();
      const target = await owner();
      const targetSourceId = sourceKind === "secondary" ? generateUuidV7() : target.sourceId;
      if (sourceKind === "secondary") {
        await submit({
          type: "database.source.create",
          ownerItemId: target.databaseId,
          sourceId: targetSourceId,
          name: "Secondary canonical target",
          titlePropertyId: generateUuidV7(),
          initialViewId: generateUuidV7(),
          initialViewName: "Secondary",
          baseRevisionId: target.definitionRevisionId,
        });
        expect(targetSourceId).not.toBe(target.sourceId);
        expect(targetSourceId).not.toBe(target.databaseId);
      }
      const configuredId = generateUuidV7();
      const legacyId = generateUuidV7();
      const definition: DatabaseDefinition = {
        ...origin.definition,
        properties: [
          ...origin.definition.properties,
          ...[configuredId, legacyId].map((id, index) => ({
            id,
            name: index === 0 ? "Configured relation" : "Historical relation",
            type: "relation" as const,
            state: "active" as const,
            positionKey: index === 0 ? "b" : "c",
            config: { cardinality: "many" as const },
          })),
        ],
      };
      const defined = await submit({
        type: "database.definition.replace",
        databaseId: origin.databaseId,
        baseRevisionId: origin.definitionRevisionId,
        definition,
      });
      const memberId = generateUuidV7();
      await submit({
        type: "database.entry.create",
        databaseId: target.databaseId,
        sourceId: targetSourceId,
        id: memberId,
        title: "Canonical target member",
        values: {},
        relationTargets: {},
      });
      const outsideId = generateUuidV7();
      await submit({
        type: "item.create",
        kind: "page",
        id: outsideId,
        name: "Historical outside page",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "z" },
      });
      const entryId = generateUuidV7();
      await submit({
        type: "database.entry.create",
        databaseId: origin.databaseId,
        id: entryId,
        title: "Mixed historical links",
        values: {},
        relationTargets: { [configuredId]: [memberId, outsideId], [legacyId]: [outsideId] },
      });
      // Configure only after the historical outside link exists. Recovery must not
      // revalidate it as a new link and silently drop or regenerate it.
      await submit({
        type: "database.definition.replace",
        databaseId: origin.databaseId,
        baseRevisionId: defined.result.revisionIds?.[0] as Uuid,
        definition: {
          ...definition,
          properties: definition.properties.map((property) =>
            property.id === configuredId && property.type === "relation"
              ? { ...property, config: { ...property.config, targetSourceId } }
              : property,
          ),
        },
      });

      const restored = await createDisposableWorkspace(context.postgres.connectionString);
      try {
        const contentStore = new ContentStore(new FilesystemBlobStore(restored.blobRoot));
        const appContext: AppContext = {
          db: context.handle.db,
          workspaceId: context.workspaceId,
          schemaVersion: 1,
          contentStore,
          partialUploads: new PartialUploadStore(restored.blobRoot),
        };
        const exported = await buildManifest(appContext);
        expect(validateCanonicalExport(exported)).toEqual([]);
        const links = exported.relationships.filter((link) => link.sourceItemId === entryId);
        expect(links).toHaveLength(3);
        expect(new Set(links.map((link) => link.id)).size).toBe(3);
        expect(links.map((link) => link.targetItemId)).toEqual(
          expect.arrayContaining([memberId, outsideId]),
        );

        let ciphertext = Buffer.alloc(0);
        let storedName = "";
        const destination: BackupDestination = {
          name: "relation-recovery-memory",
          put: async (name, contents) => {
            storedName = name;
            const chunks: Buffer[] = [];
            for await (const chunk of contents) chunks.push(Buffer.from(chunk as Uint8Array));
            ciphertext = Buffer.concat(chunks);
          },
          read: async (name) => (name === storedName ? Readable.from([ciphertext]) : null),
          list: async () => [
            { name: storedName, byteLength: ciphertext.length, storedAt: new Date() },
          ],
          delete: async () => undefined,
        };
        const key = randomBytes(32);
        const outcome = await new BackupService({
          context: appContext,
          destination,
          applicationVersion: "057-recovery-test",
          seal: (plaintext, sealedPath) => sealBackupArchiveStream(key, plaintext, sealedPath),
        }).run("manual");
        expect(outcome).toMatchObject({ verifiedAfterCreation: true, verifiedAfterTransfer: true });
        expect(ciphertext.includes(Buffer.from("Historical outside page"))).toBe(false);
        const archive = openBackupArchive(key, ciphertext);
        const inspected = inspectBackupArchive(archive);
        expect(inspected.ok).toBe(true);
        if (!inspected.ok) throw new Error(inspected.reason);
        const backedUp = JSON.parse(inspected.body.canonicalExport) as CanonicalExportManifest;
        expect(backedUp.databases).toEqual(exported.databases);
        expect(backedUp.relationships).toEqual(exported.relationships);

        const workspace = await getOrCreateWorkspace(restored.handle.db);
        await restored.handle.db.transaction((tx) =>
          applyArchive(
            archive,
            createDatabaseRestoreTarget({
              tx,
              workspaceId: workspace.id,
              contentStore,
            }),
          ),
        );
        const roundtrip = await buildManifest({
          ...appContext,
          db: restored.handle.db,
          workspaceId: workspace.id,
        });
        expect(validateCanonicalExport(roundtrip)).toEqual([]);
        expect(roundtrip.databases).toEqual(exported.databases);
        expect(roundtrip.databaseEntries).toEqual(exported.databaseEntries);
        expect(roundtrip.databasePresentations).toEqual(exported.databasePresentations);
        expect(
          roundtrip.relationships.map(({ workspaceId: _workspaceId, ...link }) => link),
        ).toEqual(exported.relationships.map(({ workspaceId: _workspaceId, ...link }) => link));
        const restoredDefinition = await readCurrentDatabaseDefinition(
          restored.handle.db,
          origin.databaseId,
        );
        expect(
          restoredDefinition?.properties.find((property) => property.id === configuredId),
        ).toMatchObject({ config: { cardinality: "many", targetSourceId } });
        expect(
          restoredDefinition?.properties.find((property) => property.id === legacyId)?.config,
        ).toEqual({ cardinality: "many" });
        const targets = await readDatabaseRelationTargets(restored.handle.db, {
          databaseId: origin.databaseId,
          entryId,
        });
        expect(targets[configuredId]).toEqual(expect.arrayContaining([memberId, outsideId]));
        expect(targets[legacyId]).toEqual([outsideId]);
      } finally {
        await restored.release();
      }
    },
    120_000,
  );
});
