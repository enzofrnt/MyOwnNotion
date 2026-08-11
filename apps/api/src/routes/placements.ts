/**
 * Placement routes (T032 US1, T059 US2): move/reorder, remove, and add file
 * placements.
 */

import {
  type CreatePlacementDto,
  CreatePlacementSchema,
  type MovePlacementDto,
  MovePlacementSchema,
  MutationResultSchema,
} from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { handleMutation } from "../plugins/mutations.ts";

const PlacementParamsSchema = Type.Object({ placementId: Type.String({ format: "uuid" }) });
const ItemParamsSchema = Type.Object({ itemId: Type.String({ format: "uuid" }) });

export function registerPlacementRoutes(app: FastifyInstance, context: AppContext): void {
  app.post(
    "/v1/items/:itemId/placements",
    {
      schema: {
        params: ItemParamsSchema,
        body: CreatePlacementSchema,
        response: { 201: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      const body = request.body as CreatePlacementDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        request,
        reply,
        successStatus: 201,
        command: {
          type: "file.placement.add",
          itemId: itemId as Uuid,
          kind: body.kind,
          parentItemId: body.parentItemId as Uuid | null,
          positionKey: body.positionKey,
        },
      });
    },
  );

  app.post(
    "/v1/placements/:placementId/move",
    {
      schema: {
        params: PlacementParamsSchema,
        body: MovePlacementSchema,
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { placementId } = request.params as { placementId: string };
      const body = request.body as MovePlacementDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        request,
        reply,
        command: {
          type: "placement.move",
          placementId: placementId as Uuid,
          parentItemId: body.parentItemId as Uuid | null,
          positionKey: body.positionKey,
        },
      });
    },
  );

  app.delete(
    "/v1/placements/:placementId",
    {
      schema: {
        params: PlacementParamsSchema,
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { placementId } = request.params as { placementId: string };
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        request,
        reply,
        command: { type: "placement.remove", placementId: placementId as Uuid },
      });
    },
  );
}
