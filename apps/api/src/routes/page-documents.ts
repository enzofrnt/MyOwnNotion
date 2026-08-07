/**
 * Page-document replacement (T058, US2): only page items carry a document;
 * a stale causal base yields a structured conflict.
 */
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  MutationResultSchema,
  ReplacePageDocumentSchema,
  type ReplacePageDocumentDto,
} from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import type { AppContext } from "../context.ts";
import { handleMutation } from "../plugins/mutations.ts";

export function registerPageDocumentRoutes(app: FastifyInstance, context: AppContext): void {
  app.put(
    "/v1/pages/:itemId/document",
    {
      schema: {
        params: Type.Object({ itemId: Type.String({ format: "uuid" }) }),
        body: ReplacePageDocumentSchema,
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      const body = request.body as ReplacePageDocumentDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        request,
        reply,
        command: {
          type: "page.document.replace",
          itemId: itemId as Uuid,
          baseRevisionId: body.baseRevisionId as Uuid,
          document: {
            format: body.document.format,
            formatVersion: body.document.formatVersion,
            body: body.document.body as Record<string, unknown>,
          },
        },
      });
    },
  );
}
