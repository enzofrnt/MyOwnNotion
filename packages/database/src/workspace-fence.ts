/**
 * The workspace fence (feature 058).
 *
 * Lookups by identifier — an item, a placement, a revision — used to need no
 * workspace: there was only one. With several accounts, an identifier that
 * belongs to another workspace must behave exactly like one that does not
 * exist, wherever it arrives from: a route parameter, a request body, a
 * reference inside a command.
 *
 * Rather than threading a workspace through every call, the API registers a
 * resolver for the workspace bound to the current request, and the lookups
 * below add `workspace_id = <bound>` whenever one is bound. Outside a request
 * (CLI, background jobs on one runtime, restore tooling) the resolver returns
 * null and lookups behave as before; those callers already work on one
 * workspace explicitly.
 */

import { eq, inArray, type SQL, sql } from "drizzle-orm";
import { items } from "./schema/index.ts";

type Resolver = () => string | null;

let resolver: Resolver = () => null;

/** Installed once by the API composition. */
export function setWorkspaceFence(next: Resolver): void {
  resolver = next;
}

/** The workspace the current caller is confined to, or null when unconfined. */
export function fencedWorkspaceId(): string | null {
  return resolver();
}

/** `column = bound workspace`, or undefined when no workspace is bound. */
export function withinFence(column: Parameters<typeof eq>[0]): SQL | undefined {
  const workspaceId = resolver();
  return workspaceId === null ? undefined : eq(column, workspaceId);
}

/** For tables without `workspace_id`: their item must belong to the fence. */
export function itemWithinFence(itemColumn: Parameters<typeof eq>[0]): SQL | undefined {
  const workspaceId = resolver();
  return workspaceId === null
    ? undefined
    : inArray(
        itemColumn,
        sql`(SELECT ${items.id} FROM ${items} WHERE ${items.workspaceId} = ${workspaceId})`,
      );
}
