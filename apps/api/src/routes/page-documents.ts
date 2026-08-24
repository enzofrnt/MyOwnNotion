/**
 * Page-document replacement (T058, US2): only page items carry a document;
 * a stale causal base yields a structured conflict.
 */

import {
  MutationResultSchema,
  PageOperationProblemSchema,
  type ReplacePageDocumentDto,
  ReplacePageDocumentSchema,
} from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import { PAGE_OPERATION_PROTOCOL_VERSION } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { handleMutation } from "../plugins/mutations.ts";

function protocolReadOnlyProblem() {
  return {
    code: "page-operations.protocol-read-only" as const,
    message: "This page uses convergent synchronization and cannot be replaced as one document.",
    requiredProtocol: PAGE_OPERATION_PROTOCOL_VERSION,
    readAllowed: true,
  };
}

export function registerPageDocumentRoutes(app: FastifyInstance, context: AppContext): void {
  app.put(
    "/v1/pages/:itemId/document",
    {
      schema: {
        params: Type.Object({ itemId: Type.String({ format: "uuid" }) }),
        body: ReplacePageDocumentSchema,
        response: { 200: MutationResultSchema, 426: PageOperationProblemSchema },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      const body = request.body as ReplacePageDocumentDto;
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        search: context.search,
        structuredQueries: context.structuredQueries,
        problemResponse: (problem) =>
          problem.code === "page-operations.protocol-read-only"
            ? { status: 426, body: protocolReadOnlyProblem() }
            : undefined,
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
          ...(body.pageLinkTargetIds !== undefined
            ? { pageLinkTargetIds: body.pageLinkTargetIds as Uuid[] }
            : {}),
        },
      });
    },
  );
}
