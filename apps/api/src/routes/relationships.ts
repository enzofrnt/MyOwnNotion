/**
 * Relationship routes (T067, US3): create, list, remove.
 */

import {
  type CreateRelationshipDto,
  CreateRelationshipSchema,
  MutationResultSchema,
  RelationshipsListResponseSchema,
} from "@myownnotion/contracts";
import { listRelationships } from "@myownnotion/database";
import { isUuid, type Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { sendProblem } from "../plugins/errors.ts";
import { handleMutation } from "../plugins/mutations.ts";
import { resolveProtectedRelationships } from "../security/content-resolution.ts";

export function registerRelationshipRoutes(app: FastifyInstance, context: AppContext): void {
  app.get(
    "/v1/relationships",
    {
      schema: {
        querystring: Type.Object({ itemId: Type.Optional(Type.String()) }),
        response: { 200: RelationshipsListResponseSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.query as { itemId?: string };
      // A malformed endpoint must never broaden the request to the whole workspace.
      if (itemId !== undefined && !isUuid(itemId)) {
        return sendProblem(reply, {
          code: "validation.invalid-identifier",
          title: "Relationship item identifier must be a UUID",
        });
      }
      const relationships = await context.db.transaction(async (tx) =>
        resolveProtectedRelationships(
          tx,
          await listRelationships(tx, context.workspaceId, itemId),
          context.protectedContent,
        ),
      );
      return { relationships };
    },
  );

  app.post(
    "/v1/relationships",
    {
      schema: {
        body: CreateRelationshipSchema,
        response: { 201: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as CreateRelationshipDto;
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
          type: "relationship.create",
          id: body.id as Uuid,
          sourceItemId: body.sourceItemId as Uuid,
          targetItemId: body.targetItemId as Uuid,
          relationType: body.relationType,
          ...(body.metadata !== undefined
            ? { metadata: body.metadata as Record<string, unknown> }
            : {}),
        },
      });
    },
  );

  app.delete(
    "/v1/relationships/:relationshipId",
    {
      schema: {
        params: Type.Object({ relationshipId: Type.String({ format: "uuid" }) }),
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { relationshipId } = request.params as { relationshipId: string };
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        search: context.search,
        structuredQueries: context.structuredQueries,
        request,
        reply,
        command: { type: "relationship.remove", relationshipId: relationshipId as Uuid },
      });
    },
  );
}
