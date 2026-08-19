/**
 * Item routes (T032, US1): create, list, get, rename, trash, restore.
 */

import {
  type ConvertItemDto,
  ConvertItemSchema,
  type CreateItemDto,
  CreateItemSchema,
  type FavouriteItemDto,
  FavouriteItemSchema,
  ItemSchema,
  ItemsListResponseSchema,
  MutationResultSchema,
  type OfflineIntentDto,
  OfflineIntentSchema,
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
import { resolveProtectedContent } from "../security/content-resolution.ts";

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
      const rows = await listItems(context.db, context.workspaceId, {
        ...(parentItemId !== undefined ? { parentItemId } : {}),
        ...(query.lifecycle !== undefined ? { lifecycle: query.lifecycle } : {}),
      });
      // The sealed copy wins where it exists. Before this, envelopes were
      // written and never read back, so a corrupted one changed nothing a
      // caller could see — which is the same as not encrypting at all, from
      // the point of view of anyone relying on it.
      const items = await resolveProtectedContent(context.db, rows, context.protectedContent);
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
        search: context.search,
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
      const row = await readItem(context.db, itemId as Uuid);
      if (row === null) {
        return sendProblem(reply, { code: "item.not-found", title: "Item does not exist" });
      }
      const [item] = await resolveProtectedContent(context.db, [row], context.protectedContent);
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
        search: context.search,
        request,
        reply,
        command: { type: "item.rename", itemId: itemId as Uuid, name: body.name },
      });
    },
  );

  app.post(
    "/v1/items/:itemId/convert",
    {
      schema: {
        params: ItemParamsSchema,
        body: ConvertItemSchema,
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      const body = request.body as ConvertItemDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        search: context.search,
        request,
        reply,
        command: {
          type: "item.convert",
          itemId: itemId as Uuid,
          targetKind: body.targetKind,
          // Absent means not confirmed. The domain refuses a destructive
          // conversion without this, so the route does not need to decide
          // anything — it only passes the owner's answer through.
          confirmedDestruction: body.confirmedDestruction === true,
        },
      });
    },
  );

  app.post(
    "/v1/items/:itemId/favourite",
    {
      schema: {
        params: ItemParamsSchema,
        body: FavouriteItemSchema,
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      const body = request.body as FavouriteItemDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        search: context.search,
        request,
        reply,
        command: { type: "item.favourite", itemId: itemId as Uuid, favourite: body.favourite },
      });
    },
  );

  app.post(
    "/v1/items/:itemId/offline",
    {
      schema: {
        params: ItemParamsSchema,
        body: OfflineIntentSchema,
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      const body = request.body as OfflineIntentDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        search: context.search,
        request,
        reply,
        command: { type: "item.offline", itemId: itemId as Uuid, offline: body.offline },
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
        search: context.search,
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
        search: context.search,
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
