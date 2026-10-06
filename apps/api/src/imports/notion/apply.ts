import {
  readDatabasePresentationRecord,
  readDatabaseRecordBySourceId,
  runMutation,
  schema,
  type Transaction,
} from "@myownnotion/database";
import {
  type MutationCommand,
  pageLinkTargets,
  pageLinkTargetsV3,
  readDocumentBody,
  type Uuid,
  validateDatabaseDefinition,
  validatePageDocument,
  validatePageDocumentEnvelopeV3,
} from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { publishCanonicalFile } from "../../files/canonical-file-import.ts";
import { submitCanonicalMutation } from "../../plugins/mutations.ts";
import { announceCommitted } from "../../sync/change-notifier.ts";
import { checkAbort } from "./api-client.ts";
import { type ImportPlan, importId } from "./model.ts";
import { creationOrder } from "./plan.ts";
import { digest, NotionImportError, SOURCE_LIMITS } from "./source.ts";
import type { NotionTarget } from "./target.ts";

interface Job {
  version: 1;
  fingerprint: string;
  snapshotDigest: string;
  rootId: Uuid;
  backupId: string | null;
  complete: boolean;
}
interface Step {
  id: Uuid;
  revisionIds: Uuid[];
}
export async function loadNotionImportPlan(target: NotionTarget, id: Uuid): Promise<ImportPlan> {
  return runMutation(target.context.db, async (tx) => {
    await target.ready(tx);
    const bytes = await target.runtime.records.read(tx, {
      entityType: "import.snapshot",
      entityId: id,
    });
    if (bytes === null) throw new NotionImportError("import.resume-not-found");
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    if (raw.version !== 2 || raw.id !== id || !Array.isArray(raw.snapshot?.files))
      throw new NotionImportError("import.invalid-checkpoint");
    let total = 0;
    const files = raw.snapshot.files.map(
      (file: { path: string; base64: string; sha256: string }) => {
        const bytes = new Uint8Array(Buffer.from(file.base64, "base64"));
        total += bytes.length;
        if (total > SOURCE_LIMITS.totalBytes || digest(bytes) !== file.sha256)
          throw new NotionImportError("import.invalid-checkpoint");
        return { path: file.path, bytes, sha256: file.sha256 };
      },
    );
    return { ...raw, snapshot: { ...raw.snapshot, files } } as ImportPlan;
  });
}
function blankDocument() {
  return { format: "myownnotion.document+json" as const, formatVersion: 2, body: { blocks: [] } };
}

export { creationOrder } from "./plan.ts";
export async function applyNotionImport(
  plan: ImportPlan,
  target: NotionTarget,
  options: {
    afterOperation?: (completed: number) => Promise<void>;
    signal?: AbortSignal | undefined;
  } = {},
) {
  if (plan.report.issues.some((issue) => issue.blocking))
    throw new NotionImportError("import.preview-blocked");
  for (const page of plan.pages) {
    const valid =
      page.document.formatVersion === 3
        ? validatePageDocumentEnvelopeV3(page.document).ok
        : (() => {
            const parsed = readDocumentBody(page.document.body);
            return (
              validatePageDocument(page.document).ok && parsed.kind === "blocks" && parsed.result.ok
            );
          })();
    if (!valid) throw new NotionImportError("import.invalid-document");
  }
  for (const database of plan.databases)
    for (const source of database.sources)
      if (!validateDatabaseDefinition(source.definition).ok)
        throw new NotionImportError("import.invalid-definition");
  checkAbort(options.signal);
  const order = creationOrder(plan);
  const { context, runtime } = target;
  const lock = await target.database.pool.connect();
  const lockKey = Buffer.from(plan.id.replaceAll("-", ""), "hex").readInt32BE(0);
  let locked = false;
  let completed = 0;
  const read = async <T>(
    tx: Transaction,
    entityType: string,
    entityId: string,
  ): Promise<T | null> => {
    const bytes = await runtime.records.read(tx, { entityType, entityId });
    return bytes === null ? null : (JSON.parse(new TextDecoder().decode(bytes)) as T);
  };
  const write = async (tx: Transaction, entityType: string, entityId: string, value: unknown) =>
    runtime.records.write(tx, {
      entityType,
      entityId,
      recordVersion: 1,
      payload: new TextEncoder().encode(JSON.stringify(value)),
    });
  const headKey = (id: Uuid) => importId(plan.id, `head:${id}`);
  const sourceIds = new Set(
    plan.databases.flatMap((database) => database.sources.map((source) => source.id)),
  );
  const currentHead = async (tx: Transaction, id: Uuid) => {
    // The owned source definition can advance independently of the container presentation.
    if (sourceIds.has(id))
      return (await readDatabaseRecordBySourceId(tx, id))?.definitionRevisionId ?? null;
    const [item] = await tx
      .select({ currentRevisionId: schema.items.currentRevisionId })
      .from(schema.items)
      .where(eq(schema.items.id, id));
    return item?.currentRevisionId ?? null;
  };
  const checkHead = async (tx: Transaction, id: Uuid) => {
    const expected = await read<{ revisionId: string }>(tx, "import.head", headKey(id));
    if (!expected || (await currentHead(tx, id)) !== expected.revisionId)
      throw new NotionImportError("import.target-changed");
    return expected.revisionId as Uuid;
  };
  const checkpoint = async (
    tx: Transaction,
    id: Uuid,
    itemIds: readonly Uuid[],
    revisionIds: Uuid[] = [],
  ) => {
    for (const itemId of itemIds) {
      const revisionId = await currentHead(tx, itemId);
      if (revisionId) await write(tx, "import.head", headKey(itemId), { revisionId });
    }
    await write(tx, "import.step", id, { id, revisionIds } satisfies Step);
  };
  const command = async (
    key: string,
    make: (tx: Transaction) => Promise<MutationCommand>,
    changedTarget?: Uuid,
    extraHeads: readonly Uuid[] = [],
  ) => {
    checkAbort(options.signal);
    const mutationId = importId(plan.id, `operation:${key}`);
    const prior = await runMutation(context.db, async (tx) => {
      await target.ready(tx);
      return read<Step>(tx, "import.step", mutationId);
    });
    if (prior) {
      if (changedTarget) await runMutation(context.db, (tx) => checkHead(tx, changedTarget));
      return;
    }
    const input = await runMutation(context.db, make);
    const result = await submitCanonicalMutation({
      ...context,
      mutationId,
      command: input,
      authorize: async (tx) => {
        await target.ready(tx);
        const [existing] = await tx
          .select({ id: schema.mutations.id })
          .from(schema.mutations)
          .where(eq(schema.mutations.id, mutationId));
        if (existing) throw new NotionImportError("import.identity-conflict");
        if (changedTarget) await checkHead(tx, changedTarget);
      },
      onAccepted: async (tx, accepted) =>
        checkpoint(tx, mutationId, [...accepted.changedItemIds, ...extraHeads]),
    });
    if (result.result.status !== "accepted")
      throw new NotionImportError(result.result.problem?.code ?? "import.canonical-refused");
    completed += 1;
    await options.afterOperation?.(completed);
  };
  try {
    const acquired = await lock.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [2801, lockKey],
    );
    if (acquired.rows[0]?.acquired !== true) throw new NotionImportError("import.already-running");
    locked = true;
    let job = await runMutation(context.db, async (tx) => {
      await target.ready(tx);
      return read<Job>(tx, "import.job", plan.id);
    });
    if (
      job &&
      (job.fingerprint !== plan.fingerprint || job.snapshotDigest !== plan.snapshot.digest)
    )
      throw new NotionImportError("import.source-changed");
    if (job?.complete)
      return { rootId: plan.rootId, completed: 0, alreadyComplete: true, backupId: job.backupId };
    if (!job) {
      // Every new import takes a verified full snapshot, including an empty target.
      // This also covers an owner write between the occupancy check and first import write.
      const receipt = await target.backup();
      job = {
        version: 1,
        fingerprint: plan.fingerprint,
        snapshotDigest: plan.snapshot.digest,
        rootId: plan.rootId,
        backupId: receipt.backupId,
        complete: false,
      };
      await runMutation(context.db, async (tx) => {
        await target.ready(tx);
        await write(tx, "import.job", plan.id, job);
        await write(tx, "import.provenance", plan.id, plan.report);
        await write(tx, "import.snapshot", plan.id, {
          ...plan,
          snapshot: {
            ...plan.snapshot,
            files: plan.snapshot.files.map(({ bytes, ...file }) => ({
              ...file,
              base64: Buffer.from(bytes).toString("base64"),
            })),
          },
        });
      });
    }
    for (const folder of plan.folders)
      await command(`folder:${folder.id}`, async () => ({
        type: "item.create",
        id: folder.id,
        kind: "folder",
        name: folder.name,
        placement: { kind: "hierarchy", parentItemId: folder.parentId, positionKey: "a" },
      }));
    for (const operation of order) {
      if (operation.kind === "database") {
        const database = plan.databases.find((value) => value.id === operation.id);
        if (!database) throw new NotionImportError("import.invalid-plan");
        const sources = database.sources.length
          ? database.sources
          : [
              {
                id: importId(database.id, "empty-source"),
                name: database.name,
                titlePropertyId: importId(database.id, "empty-title"),
                initialViewId: importId(database.id, "empty-view"),
                definition: null,
              },
            ];
        for (const [index, source] of sources.entries()) {
          if (index === 0)
            await command(
              `database:${database.id}`,
              async () => ({
                type: "database.create",
                id: database.id,
                sourceId: source.id,
                name: database.name,
                titlePropertyId: source.titlePropertyId,
                initialViewId: source.initialViewId,
                initialViewName: "Import — table par défaut",
                placement: {
                  id: importId(database.id, "placement"),
                  parentItemId: database.parentId,
                  positionKey: database.positionKey,
                },
              }),
              undefined,
              [source.id],
            );
          else
            await command(
              `source:${source.id}`,
              async (tx) => {
                const record = await readDatabasePresentationRecord(tx, database.id);
                if (!record) throw new NotionImportError("import.target-changed");
                return {
                  type: "database.source.create",
                  ownerItemId: database.id,
                  sourceId: source.id,
                  name: source.name,
                  titlePropertyId: source.titlePropertyId,
                  initialViewId: source.initialViewId,
                  initialViewName: "Import — table par défaut",
                  baseRevisionId: record.presentationRevisionId,
                };
              },
              database.id,
              [source.id],
            );
          if (source.definition) {
            const definition = source.definition;
            await command(
              `schema:${source.id}`,
              async (tx) => ({
                type: "database.definition.replace",
                databaseId: database.id,
                sourceId: source.id,
                baseRevisionId: await checkHead(tx, source.id),
                definition,
              }),
              source.id,
              [source.id],
            );
          }
        }
        if (!database.sources.length)
          await command(
            `empty:${database.id}`,
            async (tx) => {
              const record = await readDatabasePresentationRecord(tx, database.id);
              if (!record) throw new NotionImportError("import.target-changed");
              return {
                type: "database.source.delete",
                ownerItemId: database.id,
                sourceId: importId(database.id, "empty-source"),
                baseRevisionId: record.presentationRevisionId,
              };
            },
            database.id,
          );
      } else {
        const page = plan.pages.find((page) => page.id === operation.id);
        if (!page) throw new NotionImportError("import.invalid-plan");
        await command(`page:${page.id}`, async () =>
          page.databaseId
            ? {
                type: "database.entry.create",
                databaseId: page.databaseId,
                ...(page.sourceId ? { sourceId: page.sourceId } : {}),
                id: page.id,
                title: page.title,
                placement: {
                  id: importId(page.id, "placement"),
                  parentItemId: page.parentId,
                  positionKey: page.positionKey,
                },
                document: blankDocument(),
                values: page.values ?? {},
                relationTargets: {},
              }
            : {
                type: "item.create",
                id: page.id,
                kind: "page",
                name: page.title,
                placement: {
                  kind: "hierarchy",
                  parentItemId: page.parentId,
                  positionKey: page.positionKey,
                },
                pageDocument: blankDocument(),
              },
        );
      }
    }
    // External view sources may be created by a later owner in creationOrder.
    for (const database of plan.databases) {
      if (!database.views.length) continue;
      await command(
        `presentation:${database.id}`,
        async (tx) => {
          const record = await readDatabasePresentationRecord(tx, database.id);
          if (!record) throw new NotionImportError("import.target-changed");
          return {
            type: "database.presentation.replace",
            containerItemId: database.id,
            baseRevisionId: record.presentationRevisionId,
            presentation: {
              format: "myownnotion.database-presentation+json",
              formatVersion: 1,
              containerItemId: database.id,
              views: database.views,
            },
          };
        },
        database.id,
      );
    }
    for (const file of plan.files) {
      checkAbort(options.signal);
      const mutationId = importId(plan.id, `operation:file:${file.id}`);
      const published = await runMutation(context.db, async (tx) => {
        await target.ready(tx);
        if (await read<Step>(tx, "import.step", mutationId)) return null;
        const [existing] = await tx
          .select({ id: schema.mutations.id })
          .from(schema.mutations)
          .where(eq(schema.mutations.id, mutationId));
        if (existing) throw new NotionImportError("import.identity-conflict");
        const source = plan.snapshot.files.find((candidate) => candidate.path === file.path);
        if (!source) throw new NotionImportError("import.invalid-plan");
        const bytes = (async function* () {
          yield source.bytes;
        })();
        const stored = await runtime.files.ingest(tx, bytes, {
          maxBytes: source.bytes.length,
          expectedLength: source.bytes.length,
        });
        const result = await publishCanonicalFile(tx, context, {
          mutationId,
          itemId: file.id,
          name: file.name,
          mediaType: file.mediaType,
          content: stored,
          placement: { kind: "hierarchy", parentItemId: file.parentId, positionKey: "a" },
          acceptedAt: new Date(),
        });
        await checkpoint(tx, mutationId, [file.id], [result.revisionId]);
        return result;
      });
      if (published) {
        announceCommitted(published.committedSequence);
        completed += 1;
        await options.afterOperation?.(completed);
      }
    }
    for (const database of plan.databases) {
      if (!database.icon) continue;
      const icon = database.icon;
      await command(
        `icon:${database.id}`,
        async (tx) => ({
          type: "item.icon",
          itemId: database.id,
          baseRevisionId: await checkHead(tx, database.id),
          icon,
        }),
        database.id,
      );
    }
    for (const page of plan.pages) {
      if (page.icon) {
        const icon = page.icon;
        await command(
          `icon:${page.id}`,
          async (tx) => ({
            type: "item.icon",
            itemId: page.id,
            baseRevisionId: await checkHead(tx, page.id),
            icon,
          }),
          page.id,
        );
      }
      await command(
        `document:${page.id}`,
        async (tx) => ({
          type: "page.document.replace",
          itemId: page.id,
          baseRevisionId: await checkHead(tx, page.id),
          document: page.document,
          pageLinkTargetIds: (() => {
            if (page.document.formatVersion === 3) {
              const parsed = validatePageDocumentEnvelopeV3(page.document);
              return parsed.ok ? pageLinkTargetsV3(parsed.envelope.body) : [];
            }
            const parsed = readDocumentBody(page.document.body);
            return parsed.kind === "blocks" && parsed.result.ok
              ? pageLinkTargets(parsed.result.document)
              : [];
          })(),
        }),
        page.id,
      );
      if (page.databaseId && Object.keys(page.relationTargets ?? {}).length)
        await command(
          `relations:${page.id}`,
          async (tx) => ({
            type: "database.entry.values.replace",
            databaseId: page.databaseId as Uuid,
            entryId: page.id,
            baseRevisionId: await checkHead(tx, page.id),
            values: page.values ?? {},
            relationTargets: page.relationTargets ?? {},
          }),
          page.id,
        );
    }
    await runMutation(context.db, async (tx) => {
      await target.ready(tx);
      await write(tx, "import.job", plan.id, { ...job, complete: true });
      await target.audit.recordInTransaction(
        tx,
        {
          installationId: target.installationId,
          workspaceId: context.workspaceId,
          correlationId: plan.id,
          actorClass: "hosting-admin",
        },
        {
          eventType: "admin.cli-command-executed",
          outcome: "success",
          objectKind: "notion-import",
          objectId: plan.id,
        },
      );
    });
    return { rootId: plan.rootId, completed, alreadyComplete: false, backupId: job.backupId };
  } finally {
    if (locked) await lock.query("SELECT pg_advisory_unlock($1, $2)", [2801, lockKey]);
    lock.release();
  }
}
