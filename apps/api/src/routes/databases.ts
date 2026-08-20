import {
  type CreateDatabaseRequestDto,
  CreateDatabaseRequestSchema,
  type CreateEntryRequestDto,
  CreateEntryRequestSchema,
  DatabaseEntrySchema,
  DatabaseMutationResultSchema,
  DatabaseProjectionUnavailableProblemSchema,
  type DatabaseQueryDto,
  DatabaseQueryPageSchema,
  DatabaseQuerySchema,
  DatabaseSchema,
  DefinitionImpactSchema,
  EntryMutationResultSchema,
  ProblemSchema,
  ReplaceDefinitionCandidateSchema,
  type ReplaceDefinitionRequestDto,
  ReplaceDefinitionRequestSchema,
  type ReplaceEntryValuesRequestDto,
  ReplaceEntryValuesRequestSchema,
} from "@myownnotion/contracts";
import {
  listDatabaseEntryRecords,
  readDatabaseEntryRecord,
  readDatabaseRecord,
  readItem,
} from "@myownnotion/database";
import {
  previewDefinitionImpact,
  type Uuid,
  validateDatabaseDefinition,
} from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import {
  DatabaseProjectionUnavailableError,
  DatabaseQueryRequestError,
} from "../databases/database-query-service.ts";
import { sendProblem } from "../plugins/errors.ts";
import { handleMutation } from "../plugins/mutations.ts";
import {
  resolveDatabaseDefinition,
  resolveDatabaseEntryValues,
  resolveDatabaseRelationTargets,
  resolveProtectedContent,
} from "../security/content-resolution.ts";

const DatabaseParamsSchema = Type.Object({ databaseId: Type.String({ format: "uuid" }) });
const EntryParamsSchema = Type.Object({
  databaseId: Type.String({ format: "uuid" }),
  entryId: Type.String({ format: "uuid" }),
});

async function readDatabaseDto(context: AppContext, databaseId: Uuid) {
  const [record, item] = await Promise.all([
    readDatabaseRecord(context.db, databaseId),
    readItem(context.db, databaseId),
  ]);
  if (record === null || item === null) return null;
  const [resolvedItem] = await resolveProtectedContent(
    context.db,
    [item],
    context.protectedContent,
  );
  const definition = await resolveDatabaseDefinition(context.db, record, context.protectedContent);
  return {
    databaseId,
    definitionRevisionId: resolvedItem?.currentRevisionId ?? item.currentRevisionId,
    lifecycle: resolvedItem?.lifecycle ?? item.lifecycle,
    name: resolvedItem?.name ?? item.name,
    definition,
  };
}

async function readEntryDto(context: AppContext, databaseId: Uuid, entryId: Uuid) {
  const [record, item] = await Promise.all([
    readDatabaseEntryRecord(context.db, entryId),
    readItem(context.db, entryId),
  ]);
  if (record === null || item === null || record.databaseId !== databaseId) return null;
  const [resolvedItem] = await resolveProtectedContent(
    context.db,
    [item],
    context.protectedContent,
  );
  const [entryValues, relationTargets] = await Promise.all([
    resolveDatabaseEntryValues(context.db, record, context.protectedContent),
    resolveDatabaseRelationTargets(context.db, {
      databaseId,
      entryId,
      content: context.protectedContent,
    }),
  ]);
  return {
    databaseId,
    entryId,
    revisionId: resolvedItem?.currentRevisionId ?? item.currentRevisionId,
    lifecycle: resolvedItem?.lifecycle ?? item.lifecycle,
    title: resolvedItem?.name ?? item.name,
    document: resolvedItem?.pageDocument ?? item.pageDocument,
    values: entryValues.values,
    relationTargets,
  };
}

export function registerDatabaseRoutes(app: FastifyInstance, context: AppContext): void {
  app.post(
    "/v1/databases",
    {
      schema: {
        body: CreateDatabaseRequestSchema,
        response: { 201: DatabaseMutationResultSchema, 200: DatabaseMutationResultSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as CreateDatabaseRequestDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        search: context.search,
        structuredQueries: context.structuredQueries,
        request,
        reply,
        successStatus: 201,
        command: {
          type: "database.create",
          id: body.id as Uuid,
          name: body.name,
          placement: {
            id: body.placement.id as Uuid,
            parentItemId: body.placement.parentItemId as Uuid | null,
            positionKey: body.placement.positionKey,
          },
          titlePropertyId: body.titlePropertyId as Uuid,
          initialViewId: body.initialViewId as Uuid,
          initialViewName: body.initialViewName,
        },
        successBody: async ({ mutationId, revisionIds }) => ({
          mutationId,
          revisionIds,
          database: await readDatabaseDto(context, body.id as Uuid),
        }),
      });
    },
  );

  app.get(
    "/v1/databases/:databaseId",
    { schema: { params: DatabaseParamsSchema, response: { 200: DatabaseSchema } } },
    async (request, reply) => {
      const { databaseId } = request.params as { databaseId: Uuid };
      const database = await readDatabaseDto(context, databaseId);
      return (
        database ??
        sendProblem(reply, { code: "database.not-found", title: "Database does not exist" })
      );
    },
  );

  app.post(
    "/v1/databases/:databaseId/definition/impact",
    {
      schema: {
        params: DatabaseParamsSchema,
        body: ReplaceDefinitionCandidateSchema,
        response: { 200: DefinitionImpactSchema },
      },
    },
    async (request, reply) => {
      const { databaseId } = request.params as { databaseId: Uuid };
      const body = request.body as ReplaceDefinitionRequestDto;
      const [database, record] = await Promise.all([
        readDatabaseDto(context, databaseId),
        readDatabaseRecord(context.db, databaseId),
      ]);
      if (database === null || record === null) {
        return sendProblem(reply, { code: "database.not-found", title: "Database does not exist" });
      }
      if (database.definitionRevisionId !== body.baseRevisionId) {
        return sendProblem(reply, {
          code: "revision.stale-base",
          title: "Database changed since this definition was prepared",
          competingRevisionIds: [database.definitionRevisionId as Uuid],
        });
      }
      const candidate = validateDatabaseDefinition(body.definition as never);
      if (!candidate.ok || candidate.value.databaseId !== databaseId) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "Database definition is invalid",
        });
      }
      const entryRecords = await listDatabaseEntryRecords(context.db, databaseId);
      const entries = await Promise.all(
        entryRecords.map((entry) =>
          resolveDatabaseEntryValues(context.db, entry, context.protectedContent),
        ),
      );
      return previewDefinitionImpact({
        baseRevisionId: body.baseRevisionId as Uuid,
        current: database.definition,
        candidate: candidate.value,
        entries,
      });
    },
  );

  app.put(
    "/v1/databases/:databaseId/definition",
    {
      schema: {
        params: DatabaseParamsSchema,
        body: ReplaceDefinitionRequestSchema,
        response: { 200: DatabaseMutationResultSchema },
      },
    },
    async (request, reply) => {
      const { databaseId } = request.params as { databaseId: Uuid };
      const body = request.body as ReplaceDefinitionRequestDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        search: context.search,
        structuredQueries: context.structuredQueries,
        request,
        reply,
        command: {
          type: "database.definition.replace",
          databaseId,
          baseRevisionId: body.baseRevisionId as Uuid,
          definition: body.definition as never,
          ...(body.impactConfirmation === undefined
            ? {}
            : { impactConfirmation: body.impactConfirmation }),
        },
        successBody: async ({ mutationId, revisionIds }) => ({
          mutationId,
          revisionIds,
          database: await readDatabaseDto(context, databaseId),
        }),
      });
    },
  );

  app.post(
    "/v1/databases/:databaseId/entries",
    {
      schema: {
        params: DatabaseParamsSchema,
        body: CreateEntryRequestSchema,
        response: { 201: EntryMutationResultSchema, 200: EntryMutationResultSchema },
      },
    },
    async (request, reply) => {
      const { databaseId } = request.params as { databaseId: Uuid };
      const body = request.body as CreateEntryRequestDto;
      const entryId = body.id as Uuid;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        search: context.search,
        structuredQueries: context.structuredQueries,
        request,
        reply,
        successStatus: 201,
        command: {
          type: "database.entry.create",
          databaseId,
          id: entryId,
          title: body.title,
          placement: {
            id: body.placement.id as Uuid,
            parentItemId: body.placement.parentItemId as Uuid | null,
            positionKey: body.placement.positionKey,
          },
          ...(body.document === undefined ? {} : { document: body.document as never }),
          values: body.values as never,
          relationTargets: body.relationTargets as never,
        },
        successBody: async ({ mutationId, revisionIds }) => ({
          mutationId,
          revisionIds,
          entry: await readEntryDto(context, databaseId, entryId),
        }),
      });
    },
  );

  app.get(
    "/v1/databases/:databaseId/entries/:entryId",
    { schema: { params: EntryParamsSchema, response: { 200: DatabaseEntrySchema } } },
    async (request, reply) => {
      const { databaseId, entryId } = request.params as { databaseId: Uuid; entryId: Uuid };
      const entry = await readEntryDto(context, databaseId, entryId);
      return (
        entry ??
        sendProblem(reply, {
          code: "database.entry-not-found",
          title: "Database entry does not exist",
        })
      );
    },
  );

  app.put(
    "/v1/databases/:databaseId/entries/:entryId/values",
    {
      schema: {
        params: EntryParamsSchema,
        body: ReplaceEntryValuesRequestSchema,
        response: { 200: EntryMutationResultSchema },
      },
    },
    async (request, reply) => {
      const { databaseId, entryId } = request.params as { databaseId: Uuid; entryId: Uuid };
      const body = request.body as ReplaceEntryValuesRequestDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        search: context.search,
        structuredQueries: context.structuredQueries,
        request,
        reply,
        command: {
          type: "database.entry.values.replace",
          databaseId,
          entryId,
          baseRevisionId: body.baseRevisionId as Uuid,
          values: body.values as never,
          relationTargets: body.relationTargets as never,
        },
        successBody: async ({ mutationId, revisionIds }) => ({
          mutationId,
          revisionIds,
          entry: await readEntryDto(context, databaseId, entryId),
        }),
      });
    },
  );

  app.post(
    "/v1/databases/:databaseId/query",
    {
      schema: {
        params: DatabaseParamsSchema,
        body: DatabaseQuerySchema,
        response: {
          200: DatabaseQueryPageSchema,
          400: ProblemSchema,
          404: ProblemSchema,
          409: ProblemSchema,
          503: DatabaseProjectionUnavailableProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const { databaseId } = request.params as { databaseId: Uuid };
      try {
        const service = context.structuredQueries;
        if (service === undefined) {
          throw new DatabaseProjectionUnavailableError("building", 0, 0);
        }
        return reply.status(200).send(service.query(databaseId, request.body as DatabaseQueryDto));
      } catch (error) {
        if (error instanceof DatabaseProjectionUnavailableError) {
          reply.header("retry-after", "1");
          return reply
            .status(503)
            .header("content-type", "application/problem+json")
            .send({
              type: `https://myownnotion.dev/problems/${error.code}`,
              title: "Complete database view is temporarily unavailable",
              status: 503,
              code: error.code,
              projectionState: error.state,
              indexedCount: error.indexedCount,
              expectedCount: error.expectedCount,
            });
        }
        if (error instanceof DatabaseQueryRequestError) {
          return reply
            .status(error.status)
            .header("content-type", "application/problem+json")
            .send({
              type: `https://myownnotion.dev/problems/${error.code}`,
              title: "Database query cannot be executed",
              status: error.status,
              code: error.code,
            });
        }
        throw error;
      }
    },
  );
}
