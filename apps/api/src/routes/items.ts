/**
 * Item routes (T032, US1): create, list, get, rename, trash, restore.
 */

import {
  type CreateItemDto,
  CreateItemSchema,
  ItemSchema,
  ItemsListResponseSchema,
  MutationResultSchema,
  type RestoreItemDto,
  type UpdateItemDto,
  UpdateItemSchema,
} from "@myownnotion/contracts";
import { listItems, readItem } from "@myownnotion/database";
import { isUuid, type Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { sendProblem } from "../plugins/errors.ts";
import { handleMutation } from "../plugins/mutations.ts";

const ItemParamsSchema = Type.Object({ itemId: Type.String({ format: "uuid" }) });

export function registerItemRoutes(app: FastifyInstance, context: AppContext): void {
  app.get(
    "/v1/items",
    {
      schema: {
        querystring: Type.Object({
          parentItemId: Type.Optional(Type.String()),
          lifecycle: Type.Optional(
            Type.Union([Type.Literal("active"), Type.Literal("trashed"), Type.Literal("purged")]),
          ),
        }),
        response: { 200: ItemsListResponseSchema },
      },
    },
    async (request) => {
      const query = request.query as {
        parentItemId?: string;
        lifecycle?: "active" | "trashed" | "purged";
      };
      const parentItemId =
        query.parentItemId === undefined
          ? undefined
          : query.parentItemId === "root"
            ? null
            : isUuid(query.parentItemId)
              ? query.parentItemId
              : undefined;
      const items = await listItems(context.db, context.workspaceId, {
        ...(parentItemId !== undefined ? { parentItemId } : {}),
        ...(query.lifecycle !== undefined ? { lifecycle: query.lifecycle } : {}),
      });
      return { items };
    },
  );

  app.post(
    "/v1/items",
    {
      schema: {
        body: CreateItemSchema,
        response: { 201: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as CreateItemDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        request,
        reply,
        successStatus: 201,
        command: {
          type: "item.create",
          id: body.id as Uuid,
          kind: body.kind,
          name: body.name,
          placement: {
            kind: body.placement.kind,
            parentItemId: body.placement.parentItemId as Uuid | null,
            positionKey: body.placement.positionKey,
          },
          ...(body.pageDocument !== undefined
            ? {
                pageDocument: {
                  format: body.pageDocument.format,
                  formatVersion: body.pageDocument.formatVersion,
                  body: body.pageDocument.body as Record<string, unknown>,
                },
              }
            : {}),
        },
      });
    },
  );

  app.get(
    "/v1/items/:itemId",
    {
      schema: {
        params: ItemParamsSchema,
        response: { 200: ItemSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      const item = await readItem(context.db, itemId as Uuid);
      if (item === null) {
        return sendProblem(reply, { code: "item.not-found", title: "Item does not exist" });
      }
      return item;
    },
  );

  app.patch(
    "/v1/items/:itemId",
    {
      schema: {
        params: ItemParamsSchema,
        body: UpdateItemSchema,
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      const body = request.body as UpdateItemDto;
      if (body.name === undefined) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "No supported update field provided",
        });
      }
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        request,
        reply,
        command: { type: "item.rename", itemId: itemId as Uuid, name: body.name },
      });
    },
  );

  app.post(
    "/v1/items/:itemId/trash",
    {
      schema: {
        params: ItemParamsSchema,
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        request,
        reply,
        command: { type: "item.trash", itemId: itemId as Uuid },
      });
    },
  );

  app.post(
    "/v1/items/:itemId/restore",
    {
      schema: {
        params: ItemParamsSchema,
        // The restore body is optional; shape is validated when present.
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      const body = (request.body ?? {}) as RestoreItemDto;
      if (
        body.fallbackParentItemId !== undefined &&
        body.fallbackParentItemId !== null &&
        !isUuid(body.fallbackParentItemId)
      ) {
        return sendProblem(reply, {
          code: "validation.invalid-identifier",
          title: "fallbackParentItemId must be a UUID or null",
        });
      }
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        request,
        reply,
        command: {
          type: "item.restore",
          itemId: itemId as Uuid,
          ...(body.fallbackParentItemId !== undefined
            ? { fallbackParentItemId: body.fallbackParentItemId as Uuid | null }
            : {}),
        },
      });
    },
  );
}
