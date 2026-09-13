import type { McpAction, McpScope } from "@myownnotion/contracts";
import type { Database, ItemReadModel, Transaction } from "@myownnotion/database";
import { sql } from "drizzle-orm";
import { McpAccessError } from "./access-service.ts";

export function requireMcpAction(scope: McpScope, action: McpAction): void {
  if (!scope.actions.includes(action)) throw new McpAccessError();
}
/** Traverse active placements only; an attachment is authorized through its own parent. */
export async function allowedMcpIds(
  executor: Database | Transaction,
  workspaceId: string,
  scope: McpScope,
): Promise<Set<string>> {
  const roots = JSON.stringify(scope.branchRootIds);
  const result = await executor.execute<{ id: string }>(sql`
    WITH RECURSIVE permitted(id) AS (
      SELECT id FROM items WHERE workspace_id = ${workspaceId}::uuid AND lifecycle = 'active'
        AND (${scope.allContent}::boolean OR id IN (SELECT value::uuid FROM jsonb_array_elements_text(${roots}::jsonb)))
      UNION
      SELECT i.id FROM items i JOIN placements p ON p.item_id = i.id
        JOIN permitted parent ON p.parent_item_id = parent.id
      WHERE i.workspace_id = ${workspaceId}::uuid AND i.lifecycle = 'active' AND p.removed_at IS NULL
    ) SELECT i.id FROM items i JOIN permitted p ON p.id = i.id
      WHERE ${scope.files}::boolean OR i.kind <> 'file'
  `);
  return new Set(result.rows.map(({ id }) => id));
}
export function assertMcpItem(ids: ReadonlySet<string>, id: string): void {
  if (!ids.has(id)) throw new McpAccessError();
}
/** A scoped read carries neither a route to private parents nor out-of-scope reference IDs. */
export function scopedMcpItem(item: ItemReadModel, ids: ReadonlySet<string>) {
  const redactReferences = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redactReferences);
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (
      Object.entries(record).some(
        ([key, id]) =>
          ["targetItemId", "fileItemId", "databaseId", "pageId"].includes(key) &&
          typeof id === "string" &&
          !ids.has(id),
      )
    )
      return { type: "unavailable-reference" };
    return Object.fromEntries(
      Object.entries(record).map(([key, field]) => [key, redactReferences(field)]),
    );
  };
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    icon: item.icon,
    currentRevisionId: item.currentRevisionId,
    pageDocument: redactReferences(item.pageDocument),
    file: item.file,
    placements: item.placements.filter((p) => p.parentItemId === null || ids.has(p.parentItemId)),
  };
}
