import { readDatabaseRecord, runMutation, schema, type Transaction } from "@myownnotion/database";
import {
  type MutationCommand,
  pageLinkTargets,
  readDocumentBody,
  type Uuid,
  validateDatabaseDefinition,
  validatePageDocument,
} from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { publishCanonicalFile } from "../../files/canonical-file-import.ts";
import { submitCanonicalMutation } from "../../plugins/mutations.ts";
import { announceCommitted } from "../../sync/change-notifier.ts";
import { type ImportPlan, importId } from "./model.ts";
import { creationOrder } from "./plan.ts";
import { NotionImportError } from "./source.ts";
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
function blankDocument() {
  return { format: "myownnotion.document+json" as const, formatVersion: 2, body: { blocks: [] } };
}

export { creationOrder } from "./plan.ts";
export async function applyNotionImport(
  plan: ImportPlan,
  target: NotionTarget,
  options: { afterOperation?: (completed: number) => Promise<void> } = {},
) {
  if (plan.report.issues.some((issue) => issue.blocking))
    throw new NotionImportError("import.preview-blocked");
  for (const page of plan.pages) {
    const parsed = readDocumentBody(page.document.body);
    if (!validatePageDocument(page.document).ok || parsed.kind !== "blocks" || !parsed.result.ok)
      throw new NotionImportError("import.invalid-document");
  }
  for (const database of plan.databases)
    if (!validateDatabaseDefinition(database.definition).ok)
      throw new NotionImportError("import.invalid-definition");
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
  const sourceIds = new Set(plan.databases.map((source) => source.id));
  const currentHead = async (tx: Transaction, id: Uuid) => {
    // 026 definition revisions are independent of the source item's editorial head.
    if (sourceIds.has(id)) return (await readDatabaseRecord(tx, id))?.definitionRevisionId ?? null;
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
  ) => {
    const mutationId = importId(plan.id, `operation:${key}`);
    const prior = await runMutation(context.db, async (tx) => {
      await target.ready(tx);
      return read<Step>(tx, "import.step", mutationId);
    });
    if (prior) return;
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
      onAccepted: async (tx, accepted) => checkpoint(tx, mutationId, accepted.changedItemIds),
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
        const source = plan.databases.find((database) => database.id === operation.id);
        if (!source) throw new NotionImportError("import.invalid-plan");
        await command(`source:${source.id}`, async () => ({
          type: "database.create",
          id: source.id,
          name: source.name,
          hostPageId: source.hostPageId,
          titlePropertyId: source.titlePropertyId,
          initialViewId: source.initialViewId,
          initialViewName: "Import — table par défaut",
          placement: { id: source.embeddingId, parentItemId: null, positionKey: "a" },
        }));
        await command(
          `schema:${source.id}`,
          async (tx) => {
            const record = await readDatabaseRecord(tx, source.id);
            if (!record?.definitionRevisionId) throw new NotionImportError("import.target-changed");
            return {
              type: "database.definition.replace",
              databaseId: source.id,
              baseRevisionId: record.definitionRevisionId,
              definition: {
                ...source.definition,
                embeddings: source.definition.embeddings?.slice(0, 1) ?? [],
              },
            };
          },
          source.id,
        );
      } else {
        const page = plan.pages.find((page) => page.id === operation.id);
        if (!page) throw new NotionImportError("import.invalid-plan");
        await command(`page:${page.id}`, async () =>
          page.databaseId
            ? {
                type: "database.entry.create",
                databaseId: page.databaseId,
                id: page.id,
                title: page.title,
                placement: {
                  id: importId(page.id, "placement"),
                  parentItemId: page.parentId,
                  positionKey: "a",
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
                placement: { kind: "hierarchy", parentItemId: page.parentId, positionKey: "a" },
                pageDocument: blankDocument(),
              },
        );
      }
    }
    for (const file of plan.files) {
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
    for (const page of plan.pages) {
      await command(
        `document:${page.id}`,
        async (tx) => ({
          type: "page.document.replace",
          itemId: page.id,
          baseRevisionId: await checkHead(tx, page.id),
          document: page.document,
          pageLinkTargetIds: (() => {
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
    for (const source of plan.databases)
      await command(
        `displays:${source.id}`,
        async (tx) => {
          const record = await readDatabaseRecord(tx, source.id);
          if (!record?.definitionRevisionId) throw new NotionImportError("import.target-changed");
          return {
            type: "database.definition.replace",
            databaseId: source.id,
            baseRevisionId: record.definitionRevisionId,
            definition: source.definition,
          };
        },
        source.id,
      );
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
