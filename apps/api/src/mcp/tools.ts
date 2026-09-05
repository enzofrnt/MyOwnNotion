import { McpServer, type ToolCallback } from "@modelcontextprotocol/server";
import type { McpAction } from "@myownnotion/contracts";
import {
  listItems,
  readItem,
  readPageOperationState,
  runMutation,
  schema,
  type Transaction,
} from "@myownnotion/database";
import {
  documentDigestV3,
  type MutationCommand,
  migrateStoredPageDocumentToV3,
  type Uuid,
} from "@myownnotion/domain";
import type { PageCommand } from "@myownnotion/page-state";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { shareFullFileMutation } from "../backup/full/locks.ts";
import type { AppContext } from "../context.ts";
import type { PageActivationService } from "../page-state/page-activation-service.ts";
import type { PageOperationService } from "../page-state/page-operation-service.ts";
import { submitCanonicalMutation } from "../plugins/mutations.ts";
import { resolveProtectedContent } from "../security/content-resolution.ts";
import { announceCommitted } from "../sync/change-notifier.ts";
import { McpAccessError, type McpAccessService, type McpPrincipal } from "./access-service.ts";
import { allowedMcpIds, assertMcpItem, requireMcpAction, scopedMcpItem } from "./scope.ts";

const uuid = z.string().uuid();
const mutation = { mutationId: uuid };
const pageCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("replace-text"),
      blockId: uuid,
      from: z.number().int().min(0),
      to: z.number().int().min(0),
      text: z.string().max(100_000),
    })
    .strict(),
  z.object({ type: z.literal("delete-block"), blockId: uuid }).strict(),
  z
    .object({
      type: z.literal("insert-paragraph"),
      blockId: uuid,
      parentBlockId: uuid.nullable(),
      beforeBlockId: uuid.nullable(),
      text: z.string().max(100_000),
    })
    .strict(),
]);
export interface McpToolsDeps {
  context: AppContext;
  access: McpAccessService;
  operations: PageOperationService;
  activation: PageActivationService;
  principal: McpPrincipal;
  correlationId: string;
  onPageCommitted?: (event: { pageId: Uuid; latestPageSequence: number }) => void;
}
export function createMcpTools(deps: McpToolsDeps): McpServer {
  const { context, access, principal, correlationId } = deps;
  const server = new McpServer({ name: "MyOwnNotion", version: "0.1.0" });
  const authorize = async (tx: Transaction, action: McpAction) => {
    const current = await access.revalidate(tx, principal);
    requireMcpAction(current.scope, action);
    return await allowedMcpIds(tx, context.workspaceId, current.scope);
  };
  const read = async <T>(
    action: McpAction,
    name: string,
    work: (tx: Transaction, ids: Set<string>) => Promise<T>,
  ) =>
    runMutation(context.db, async (tx) => {
      const ids = await authorize(tx, action);
      const value = await work(tx, ids);
      await access.recordOperation(tx, principal, name, correlationId);
      return value;
    });
  const safe = async (action: string, work: () => Promise<unknown>) => {
    try {
      const result = await work();
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      await access.deps.audit.record(access.auditContext(principal.connectionId, correlationId), {
        eventType: "mcp.operation",
        outcome: "refused",
        objectKind: action,
        objectId: principal.connectionId,
      });
      const code = error instanceof McpAccessError ? error.code : "mcp.operation-failed";
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              code,
              message:
                "Opération refusée ou indisponible. Vérifiez le périmètre et relisez la version actuelle avant de réessayer.",
            }),
          },
        ],
      };
    }
  };
  const bindMutation = async (
    tx: Transaction,
    mutationId: string,
    action: string,
    targetId: string,
  ) => {
    const [binding] = await tx
      .select()
      .from(schema.mcpMutations)
      .where(eq(schema.mcpMutations.mutationId, mutationId));
    if (binding !== undefined) {
      if (
        binding.connectionId !== principal.connectionId ||
        binding.action !== action ||
        binding.targetId !== targetId
      )
        throw new McpAccessError("mcp.mutation-conflict", 409);
      return;
    }
    const [prior] = await tx
      .select()
      .from(schema.mutations)
      .where(eq(schema.mutations.id, mutationId));
    if (prior !== undefined) throw new McpAccessError("mcp.mutation-conflict", 409);
    await tx
      .insert(schema.mcpMutations)
      .values({ mutationId, connectionId: principal.connectionId, action, targetId });
  };
  const change = async (
    action: McpAction,
    name: string,
    mutationId: string,
    targetId: string,
    command: MutationCommand,
    check: (ids: Set<string>, tx: Transaction) => Promise<void>,
  ) => {
    let authorizedIds = new Set<string>();
    const result = await submitCanonicalMutation({
      ...context,
      command,
      mutationId: mutationId as Uuid,
      attribution: { mutationId: mutationId as Uuid, deviceId: principal.deviceId },
      authorize: async (tx) => {
        const ids = await authorize(tx, action);
        authorizedIds = ids;
        await bindMutation(tx, mutationId, name, targetId);
        const [prior] = await tx
          .select()
          .from(schema.mutations)
          .where(eq(schema.mutations.id, mutationId));
        if (prior === undefined) await check(ids, tx);
        else if (action !== "create" && action !== "delete") assertMcpItem(ids, targetId);
      },
      onAccepted: async (tx, accepted) => {
        for (const changedId of accepted.changedItemIds)
          if (changedId !== targetId || action !== "create")
            assertMcpItem(authorizedIds, changedId);
        await access.recordOperation(tx, principal, name, correlationId);
      },
    });
    if (result.result.status !== "accepted" && result.result.status !== "already-accepted")
      throw new McpAccessError(result.result.problem?.code ?? "mcp.mutation-refused", 409);
    return { mutationId, revisionIds: result.result.revisionIds ?? [], itemId: targetId };
  };
  const tool = <T extends z.ZodType>(
    name: string,
    description: string,
    action: McpAction,
    inputSchema: T,
    work: (input: z.output<T>) => Promise<unknown>,
  ) => {
    if (!principal.scope.actions.includes(action)) return;
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: action === "read" || action === "search",
          destructiveHint: action === "delete",
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (async (input: unknown) => safe(name, () => work(input as z.output<T>))) as ToolCallback<T>,
    );
  };

  tool(
    "list_items",
    "List authorized pages, folders and permitted files. Opaque afterId pagination; no private ancestors.",
    "read",
    z
      .object({
        parentId: uuid.optional(),
        afterId: uuid.optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .strict(),
    (args) =>
      read("read", "list_items", async (tx, ids) => {
        if (args.parentId !== undefined) assertMcpItem(ids, args.parentId);
        const rows = await listItems(tx, context.workspaceId, {
          lifecycle: "active",
          ...(args.parentId === undefined ? {} : { parentItemId: args.parentId as Uuid }),
        });
        const candidates = rows
          .filter((row) => ids.has(row.id) && (args.afterId === undefined || row.id > args.afterId))
          .sort((a, b) => a.id.localeCompare(b.id));
        const selected = candidates.slice(0, args.limit);
        const resolved = await resolveProtectedContent(tx, selected, context.protectedContent);
        return {
          items: resolved.map((row) => ({ id: row.id, name: row.name, kind: row.kind })),
          nextAfterId: candidates.length > args.limit ? (selected.at(-1)?.id ?? null) : null,
        };
      }),
  );
  tool(
    "read_item",
    "Read authorized canonical content and the revision/digest required for safe page edits.",
    "read",
    z.object({ itemId: uuid }).strict(),
    (args) =>
      read("read", "read_item", async (tx, ids) => {
        assertMcpItem(ids, args.itemId);
        const stored = await readItem(tx, args.itemId as Uuid);
        if (stored === null) throw new McpAccessError();
        const [item] = await resolveProtectedContent(tx, [stored], context.protectedContent);
        if (item === undefined) throw new McpAccessError();
        const migrated =
          item.pageDocument === null ? null : migrateStoredPageDocumentToV3(item.pageDocument);
        return {
          ...scopedMcpItem(item, ids),
          documentDigest: migrated?.ok ? await documentDigestV3(migrated.document) : null,
        };
      }),
  );
  tool(
    "search",
    "Search one authorized branch; branchRootId is required for restricted grants. Results omit private paths.",
    "search",
    z
      .object({
        query: z.string().min(1).max(500),
        branchRootId: uuid.optional(),
        cursor: z.string().max(4096).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .strict(),
    (args) =>
      read("search", "search", async (_tx, ids) => {
        if (args.branchRootId !== undefined) assertMcpItem(ids, args.branchRootId);
        else if (!principal.scope.allContent) throw new McpAccessError("mcp.branch-required", 400);
        if (context.search === undefined) throw new McpAccessError("mcp.search-unavailable", 503);
        const result = await context.search.search({
          query: args.query,
          limit: args.limit,
          ...(args.branchRootId === undefined ? {} : { branchRootItemId: args.branchRootId }),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          ...(principal.scope.files ? {} : { kinds: ["page", "folder"] }),
        });
        return {
          results: result.results
            .filter((row) => ids.has(row.itemId))
            .map((row) => ({
              itemId: row.itemId,
              title: row.title,
              kind: row.kind,
              snippet: row.snippet,
            })),
          nextCursor: result.nextCursor,
        };
      }),
  );
  tool(
    "create_item",
    "Create a page or folder in an authorized parent. Supply stable UUIDs for id and mutationId; plain text creates one paragraph.",
    "create",
    z
      .object({
        ...mutation,
        id: uuid,
        kind: z.enum(["page", "folder"]),
        name: z.string().min(1).max(255),
        parentId: uuid.nullable(),
        text: z.string().max(100_000).default(""),
      })
      .strict(),
    (args) =>
      change(
        "create",
        "create_item",
        args.mutationId,
        args.id,
        {
          type: "item.create",
          id: args.id as Uuid,
          kind: args.kind,
          name: args.name,
          placement: {
            kind: "hierarchy",
            parentItemId: args.parentId as Uuid | null,
            positionKey: "a0",
          },
          ...(args.kind === "page"
            ? {
                pageDocument: {
                  format: "myownnotion.document+json",
                  formatVersion: 2,
                  body: {
                    blocks: [{ id: args.id, type: "paragraph", content: [{ text: args.text }] }],
                  },
                },
              }
            : {}),
        },
        async (ids) => {
          if (args.parentId === null) {
            if (!principal.scope.allContent) throw new McpAccessError();
          } else assertMcpItem(ids, args.parentId);
        },
      ),
  );
  tool(
    "rename_item",
    "Rename an authorized item through the canonical revision service.",
    "edit",
    z.object({ ...mutation, itemId: uuid, name: z.string().min(1).max(255) }).strict(),
    (args) =>
      change(
        "edit",
        "rename_item",
        args.mutationId,
        args.itemId,
        { type: "item.rename", itemId: args.itemId as Uuid, name: args.name },
        async (ids) => assertMcpItem(ids, args.itemId),
      ),
  );
  tool(
    "trash_item",
    "Move an authorized item and its descendants to the recoverable trash. Never permanently deletes.",
    "delete",
    z.object({ ...mutation, itemId: uuid }).strict(),
    (args) =>
      change(
        "delete",
        "trash_item",
        args.mutationId,
        args.itemId,
        { type: "item.trash", itemId: args.itemId as Uuid },
        async (ids, tx) => {
          assertMcpItem(ids, args.itemId);
          const affected = await allowedMcpIds(tx, context.workspaceId, {
            ...principal.scope,
            allContent: false,
            branchRootIds: [args.itemId],
            files: true,
          });
          for (const id of affected) assertMcpItem(ids, id);
          const usages = await tx
            .select()
            .from(schema.fileUsages)
            .where(eq(schema.fileUsages.fileItemId, args.itemId));
          for (const usage of usages) assertMcpItem(ids, usage.usedByItemId);
        },
      ),
  );

  tool(
    "edit_page",
    "Edit stable page blocks using an exact revision and documentDigest from read_item. New paragraphs, text ranges and block deletion preserve canonical convergence.",
    "edit",
    z
      .object({
        ...mutation,
        pageId: uuid,
        expectedRevisionId: uuid,
        expectedDocumentDigest: z.string().regex(/^[0-9a-f]{64}$/),
        commands: z.array(pageCommandSchema).min(1).max(100),
      })
      .strict(),
    async (args) => {
      const commands: PageCommand[] = args.commands.map((command) =>
        command.type === "insert-paragraph"
          ? {
              type: "insert-block",
              block: {
                id: command.blockId as Uuid,
                type: "paragraph",
                content: [{ text: command.text }],
                children: [],
              },
              parentBlockId: command.parentBlockId as Uuid | null,
              beforeBlockId: command.beforeBlockId as Uuid | null,
            }
          : { ...command, blockId: command.blockId as Uuid },
      );
      // Preparation is read-only; the authoritative proof is repeated inside the mutation transaction.
      const prepared = await read("edit", "edit_page.prepare", async (tx, ids) => {
        assertMcpItem(ids, args.pageId);
        const stored = await readItem(tx, args.pageId as Uuid);
        if (stored === null) throw new McpAccessError();
        const [item] = await resolveProtectedContent(tx, [stored], context.protectedContent);
        if (item?.pageDocument === null || item?.pageDocument === undefined)
          throw new McpAccessError();
        const migrated = migrateStoredPageDocumentToV3(item.pageDocument);
        if (!migrated.ok) throw new McpAccessError("mcp.invalid-document", 409);
        const state = await readPageOperationState(tx, context.workspaceId, args.pageId as Uuid);
        return { item, document: migrated.document, operational: state?.status === "active" };
      });
      const prove = async (ids: Set<string>, tx: Transaction) => {
        assertMcpItem(ids, args.pageId);
        const row = await readItem(tx, args.pageId as Uuid);
        if (row === null) throw new McpAccessError();
        const [item] = await resolveProtectedContent(tx, [row], context.protectedContent);
        const migrated =
          item?.pageDocument == null ? null : migrateStoredPageDocumentToV3(item.pageDocument);
        if (
          item?.currentRevisionId !== args.expectedRevisionId ||
          !migrated?.ok ||
          (await documentDigestV3(migrated.document)) !== args.expectedDocumentDigest
        )
          throw new McpAccessError("mcp.stale-page", 409);
      };
      if (!prepared.operational) {
        await deps.activation.activate({
          pageId: args.pageId as Uuid,
          ownerId: principal.ownerId,
          deviceId: principal.deviceId as Uuid,
          requestId: args.mutationId as Uuid,
          expectedRevisionId: args.expectedRevisionId as Uuid,
          expectedCanonicalDigest: args.expectedDocumentDigest,
          authorize: async (tx) => {
            const ids = await authorize(tx, "edit");
            await prove(ids, tx);
          },
        });
      }
      const result = await runMutation(context.db, async (tx) => {
        await shareFullFileMutation(tx);
        const ids = await authorize(tx, "edit");
        assertMcpItem(ids, args.pageId);
        await bindMutation(tx, args.mutationId, "edit_page", args.pageId);
        const [prior] = await tx
          .select()
          .from(schema.mutations)
          .where(eq(schema.mutations.id, args.mutationId));
        if (prior !== undefined)
          return {
            mutationId: args.mutationId,
            revisionIds: prior.resultRevisionIds,
            committedSequence: undefined,
            latestPageSequence: undefined,
          };
        await prove(ids, tx);
        await context.rotationPolicies?.assertWritesAllowed(tx);
        const applied = await deps.operations.applyServerCommands(
          {
            pageId: args.pageId as Uuid,
            deviceId: principal.deviceId as Uuid,
            mutationId: args.mutationId as Uuid,
            commands,
          },
          tx,
        );
        await access.recordOperation(tx, principal, "edit_page", correlationId);
        return {
          mutationId: args.mutationId,
          revisionIds: [applied.revisionId],
          committedSequence: applied.committedSequence,
          latestPageSequence: applied.latestPageSequence,
        };
      });
      announceCommitted(result.committedSequence);
      if (result.latestPageSequence !== undefined)
        deps.onPageCommitted?.({
          pageId: args.pageId as Uuid,
          latestPageSequence: result.latestPageSequence,
        });
      if (result.committedSequence !== undefined) {
        try {
          await context.search?.applyCommittedChanges(
            [args.pageId as Uuid],
            result.committedSequence,
          );
        } catch {
          /* projection rebuilds */
        }
        try {
          await context.structuredQueries?.applyCommittedChanges(
            [args.pageId as Uuid],
            result.committedSequence,
          );
        } catch {
          /* projection rebuilds */
        }
      }
      return {
        mutationId: result.mutationId,
        revisionIds: result.revisionIds,
        itemId: args.pageId,
      };
    },
  );
  if (principal.scope.files)
    tool(
      "read_file",
      "Read authorized encrypted file bytes as base64 chunks of at most65536 bytes. Continue from nextOffset.",
      "read",
      z
        .object({
          itemId: uuid,
          offset: z.number().int().min(0).default(0),
          length: z.number().int().min(1).max(65_536).default(65_536),
        })
        .strict(),
      (args) =>
        read("read", "read_file", async (tx, ids) => {
          assertMcpItem(ids, args.itemId);
          const [file] = await tx
            .select()
            .from(schema.logicalFiles)
            .where(eq(schema.logicalFiles.itemId, args.itemId));
          if (
            file === undefined ||
            context.protectedFiles === undefined ||
            args.offset > file.byteLength
          )
            throw new McpAccessError();
          const end = Math.min(file.byteLength, args.offset + args.length);
          const chunks: Uint8Array[] = [];
          if (end > args.offset)
            for await (const chunk of context.protectedFiles.read(tx, file.contentId, {
              start: args.offset,
              end: end - 1,
            }))
              chunks.push(chunk);
          return {
            itemId: args.itemId,
            offset: args.offset,
            data: Buffer.concat(chunks).toString("base64"),
            encoding: "base64",
            totalBytes: file.byteLength,
            nextOffset: end < file.byteLength ? end : null,
          };
        }),
    );
  return server;
}
