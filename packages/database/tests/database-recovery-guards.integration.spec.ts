/** Partial discovery must never let a stale view overwrite unavailable source state. */
import {
  executeDatabaseCommand,
  readCurrentDatabaseDefinition,
  readCurrentDatabasePresentation,
  readDatabaseRecord,
  schema,
  submitMutation,
} from "@myownnotion/database";
import {
  type DatabaseMutationCommand,
  type DatabasePresentationDefinition,
  EMPTY_PAGE_DOCUMENT,
  generateUuidV7,
  type MutationCommand,
  type Uuid,
} from "@myownnotion/domain";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);
afterAll(async () => {
  await context?.close();
});

async function submit(command: MutationCommand) {
  return submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: command.type,
    command,
  });
}

async function owner() {
  const command = {
    type: "database.create",
    id: generateUuidV7(),
    name: "Retained source",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "V" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Current view",
  } satisfies Extract<DatabaseMutationCommand, { type: "database.create" }>;
  const created = await submit(command);
  expect(created.result.status).toBe("accepted");
  const definition = await readCurrentDatabaseDefinition(context.handle.db, command.id);
  const presentation = await readCurrentDatabasePresentation(context.handle.db, command.id);
  const record = await readDatabaseRecord(context.handle.db, command.id);
  const revisionId = created.result.revisionIds?.[0];
  if (definition === null || presentation === null || record === null || revisionId === undefined)
    throw new Error("Missing durable database fixture");
  return { command, definition, presentation, record, revisionId: revisionId as Uuid };
}

async function durableState() {
  const result = await context.handle.db.execute(sql`
    SELECT (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM items i) AS items,
           (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.source_id) FROM databases d) AS sources,
           (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.item_id) FROM database_presentations p) AS views,
           (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.entry_item_id, e.database_id) FROM database_entries e) AS memberships,
           (SELECT count(*) FROM revisions) AS revisions,
           (SELECT count(*) FROM relationships) AS relationships
  `);
  return result.rows;
}

/** Enter the transactional boundary directly: it must defend callers independently of DTO validation. */
async function refuses(command: DatabaseMutationCommand, code: string) {
  const before = await durableState();
  const result = await context.handle.db.transaction((tx) =>
    executeDatabaseCommand(
      tx,
      { workspaceId: context.workspaceId, mutationId: generateUuidV7(), acceptedAt: new Date() },
      command,
    ),
  );
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(await durableState()).toEqual(before);
}

async function removeRetainedField(revisionId: Uuid, field: string) {
  // A retention/protected-content outage is represented by the structural revision
  // remaining durable while its private payload cannot be resolved.
  await context.handle.db.execute(sql`
    UPDATE revisions SET snapshot = snapshot - ${field} WHERE id = ${revisionId}::uuid
  `);
}

function replacement(
  source: Awaited<ReturnType<typeof owner>>,
  presentation: DatabasePresentationDefinition = source.presentation,
): Extract<DatabaseMutationCommand, { type: "database.presentation.replace" }> {
  return {
    type: "database.presentation.replace",
    containerItemId: source.command.id,
    baseRevisionId: source.revisionId,
    presentation,
  };
}

function linked(sourceId: Uuid) {
  return {
    type: "database_view.create",
    id: generateUuidV7(),
    name: "Linked view",
    sourceId,
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "W" },
    initialViewId: generateUuidV7(),
  } satisfies Extract<DatabaseMutationCommand, { type: "database_view.create" }>;
}

async function entry(source: Awaited<ReturnType<typeof owner>>) {
  const entryId = generateUuidV7();
  const outcome = await submit({
    type: "database.entry.create",
    databaseId: source.command.id,
    id: entryId,
    title: "Retained entry",
    values: {},
    relationTargets: {},
  });
  expect(outcome.result.status).toBe("accepted");
  return { entryId, revisionId: outcome.result.revisionIds?.[0] as Uuid };
}

describe("database view recovery boundaries", () => {
  it.each(["absent", "page", "trashed"] as const)(
    "does not replace the presentation of an %s container",
    async (state) => {
      const source = await owner();
      let containerId = generateUuidV7();
      if (state === "page") {
        await submit({
          type: "item.create",
          id: containerId,
          kind: "page",
          name: "Ordinary page",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "X" },
        });
      } else if (state === "trashed") {
        containerId = source.command.id;
        expect((await submit({ type: "item.trash", itemId: containerId })).result.status).toBe(
          "accepted",
        );
      }
      await refuses({ ...replacement(source), containerItemId: containerId }, "database.not-found");
    },
  );

  it("rejects a stale view editor without replacing the newer presentation", async () => {
    const source = await owner();
    const newer = await submit(
      replacement(source, {
        ...source.presentation,
        views: source.presentation.views.map((view) => ({ ...view, name: "Newer view" })),
      }),
    );
    expect(newer.result.status).toBe("accepted");
    await refuses(replacement(source), "revision.stale-base");
    expect(await readCurrentDatabasePresentation(context.handle.db, source.command.id)).toEqual({
      ...source.presentation,
      views: source.presentation.views.map((view) => ({ ...view, name: "Newer view" })),
    });
  });

  it("does not treat an unavailable retained presentation as an empty view set", async () => {
    const source = await owner();
    await removeRetainedField(source.revisionId, "databasePresentation");
    await refuses(replacement(source), "database.not-found");
  });

  it.each(["wrong-container", "duplicate-view"] as const)(
    "refuses a %s candidate at the transaction boundary",
    async (scenario) => {
      const source = await owner();
      await refuses(
        replacement(source, {
          ...source.presentation,
          ...(scenario === "wrong-container"
            ? { containerItemId: generateUuidV7() }
            : { views: [...source.presentation.views, ...source.presentation.views] }),
        }),
        "validation.invalid-payload",
      );
    },
  );

  it.each(["missing", "trashed"] as const)(
    "does not add a view pointing at a %s source",
    async (state) => {
      const source = await owner();
      const other = await owner();
      if (state === "trashed") {
        expect((await submit({ type: "item.trash", itemId: other.command.id })).result.status).toBe(
          "accepted",
        );
      }
      const currentView = source.presentation.views[0];
      if (currentView === undefined) throw new Error("Missing source view");
      await refuses(
        replacement(source, {
          ...source.presentation,
          views: [
            ...source.presentation.views,
            {
              ...currentView,
              id: generateUuidV7(),
              positionKey: "b",
              sourceId: state === "missing" ? generateUuidV7() : other.record.sourceId,
            },
          ],
        }),
        "database.source-unavailable",
      );
    },
  );

  it("preserves an already linked unavailable source while editing another view", async () => {
    const source = await owner();
    const other = await owner();
    const currentView = source.presentation.views[0];
    if (currentView === undefined) throw new Error("Missing source view");
    const presentation = {
      ...source.presentation,
      views: [
        ...source.presentation.views,
        { ...currentView, id: generateUuidV7(), positionKey: "b", sourceId: other.record.sourceId },
      ],
    };
    const added = await submit(replacement(source, presentation));
    expect(added.result.status).toBe("accepted");
    expect((await submit({ type: "item.trash", itemId: other.command.id })).result.status).toBe(
      "accepted",
    );
    const updated = await submit({
      ...replacement(source, {
        ...presentation,
        views: presentation.views.map((view) => ({ ...view, name: "Renamed safely" })),
      }),
      baseRevisionId: added.result.revisionIds?.[0] as Uuid,
    });
    expect(updated.result.status).toBe("accepted");
    expect(
      (await readCurrentDatabasePresentation(context.handle.db, source.command.id))?.views.map(
        (view) => view.sourceId,
      ),
    ).toEqual([source.record.sourceId, other.record.sourceId]);
  });

  it("does not create a linked view under a parent that disappeared", async () => {
    const source = await owner();
    const command = linked(source.record.sourceId);
    await refuses(
      { ...command, placement: { ...command.placement, parentItemId: generateUuidV7() } },
      "containment.parent-not-found",
    );
  });

  it.each(["missing", "trashed", "definition-unavailable", "retired-template"] as const)(
    "does not create a linked view when its source is %s",
    async (state) => {
      const source = await owner();
      if (state === "trashed") {
        expect(
          (await submit({ type: "item.trash", itemId: source.command.id })).result.status,
        ).toBe("accepted");
      } else if (state === "definition-unavailable") {
        await removeRetainedField(source.revisionId, "databaseDefinition");
      } else if (state === "retired-template") {
        await context.handle.db
          .update(schema.revisions)
          .set({
            snapshot: {
              databaseDefinition: {
                ...source.definition,
                views: source.definition.views.map((view) => ({ ...view, state: "retired" })),
              },
            },
          })
          .where(eq(schema.revisions.id, source.revisionId));
      }
      await refuses(
        linked(state === "missing" ? generateUuidV7() : source.record.sourceId),
        "database.source-unavailable",
      );
    },
  );

  it("does not create a second linked container with the same identity", async () => {
    const source = await owner();
    const command = linked(source.record.sourceId);
    expect((await submit(command)).result.status).toBe("accepted");
    await refuses(command, "mutation.duplicate");
  });
});

describe("database definition and entry recovery boundaries", () => {
  it.each(["definition", "presentation"] as const)(
    "does not replace a definition while its retained %s is unavailable",
    async (field) => {
      const source = await owner();
      await removeRetainedField(
        source.revisionId,
        field === "definition" ? "databaseDefinition" : "databasePresentation",
      );
      await refuses(
        {
          type: "database.definition.replace",
          databaseId: source.command.id,
          baseRevisionId: source.revisionId,
          definition: { ...source.definition, name: "Must not overwrite retained data" },
        },
        "database.not-found",
      );
    },
  );

  it("refuses a definition belonging to a different database before advancing either source", async () => {
    const source = await owner();
    const other = await owner();
    await refuses(
      {
        type: "database.definition.replace",
        databaseId: source.command.id,
        baseRevisionId: source.revisionId,
        definition: other.definition,
      },
      "validation.invalid-payload",
    );
  });

  it.each(["definition-unavailable", "trashed-owner", "folder-document", "existing-item"] as const)(
    "does not create an entry with %s",
    async (state) => {
      const source = await owner();
      if (state === "definition-unavailable") {
        await removeRetainedField(source.revisionId, "databaseDefinition");
      } else if (state === "trashed-owner") {
        expect(
          (await submit({ type: "item.trash", itemId: source.command.id })).result.status,
        ).toBe("accepted");
      }
      await refuses(
        {
          type: "database.entry.create",
          databaseId: source.command.id,
          id: state === "existing-item" ? source.command.id : generateUuidV7(),
          title: "Must not appear",
          values: {},
          relationTargets: {},
          ...(state === "folder-document" ? { kind: "folder", document: EMPTY_PAGE_DOCUMENT } : {}),
        },
        state === "definition-unavailable"
          ? "database.not-found"
          : state === "trashed-owner"
            ? "database.source-unavailable"
            : state === "folder-document"
              ? "validation.invalid-payload"
              : "database.membership-conflict",
      );
    },
  );

  it.each(["missing", "trashed", "definition-unavailable"] as const)(
    "refuses entry-value replacement with a %s dependency",
    async (state) => {
      const source = await owner();
      const row = await entry(source);
      if (state === "trashed") {
        expect((await submit({ type: "item.trash", itemId: row.entryId })).result.status).toBe(
          "accepted",
        );
      } else if (state === "definition-unavailable") {
        await removeRetainedField(source.revisionId, "databaseDefinition");
      }
      await refuses(
        {
          type: "database.entry.values.replace",
          databaseId: source.command.id,
          entryId: state === "missing" ? generateUuidV7() : row.entryId,
          baseRevisionId: row.revisionId,
          values: {},
          relationTargets: {},
        },
        state === "definition-unavailable" ? "database.not-found" : "database.entry-not-found",
      );
    },
  );

  it.each(["missing", "definition-unavailable", "values-unavailable"] as const)(
    "refuses conflict resolution with %s retained entry state",
    async (state) => {
      const source = await owner();
      const row = await entry(source);
      if (state !== "missing") {
        await removeRetainedField(
          state === "definition-unavailable" ? source.revisionId : row.revisionId,
          state === "definition-unavailable" ? "databaseDefinition" : "databaseEntryValues",
        );
      }
      await refuses(
        {
          type: "database.entry.values.resolve-conflict",
          databaseId: source.command.id,
          entryId: state === "missing" ? generateUuidV7() : row.entryId,
          resolvedRevisionIds: [row.revisionId, generateUuidV7()],
          values: {},
          relationTargets: {},
        },
        state === "missing" ? "database.entry-not-found" : "database.not-found",
      );
    },
  );
});
