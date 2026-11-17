/**
 * Request-scoped workspace (feature 058, research D3/D13).
 *
 * Until 058 the API resolved one workspace at boot and every service was
 * built for it. Those services are correct *for one workspace*, and they stay
 * so: the API now builds one set per workspace (a `WorkspaceRuntime`), lazily,
 * and each request runs inside an asynchronous scope naming the workspace of
 * the principal that authenticated it.
 *
 * Two rules make this an isolation boundary rather than a convenience:
 *
 *   1. **No ambient default.** Reading the current workspace outside a scope,
 *      or inside one that no principal has bound, throws. A route that forgot
 *      to authenticate cannot fall back to "the" workspace, because there is
 *      none.
 *   2. **A bound scope never changes workspace.** Binding twice to different
 *      workspaces throws, so a request cannot be re-pointed half-way through.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface Scope {
  workspaceId: string | null;
}

const storage = new AsyncLocalStorage<Scope>();

export class WorkspaceScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceScopeError";
  }
}

/** Runs `fn` inside a fresh, unbound scope. Used once per request. */
export function enterRequestScope<T>(fn: () => T): T {
  return storage.run({ workspaceId: null }, fn);
}

/** Runs `fn` bound to `workspaceId`: background jobs, sockets, tests. */
export function runInWorkspace<T>(workspaceId: string, fn: () => T): T {
  return storage.run({ workspaceId }, fn);
}

/** Binds the current request scope to the authenticated principal's workspace. */
export function bindWorkspace(workspaceId: string): void {
  const scope = storage.getStore();
  // Without a scope there is nothing to bind and nothing to read either:
  // `currentWorkspaceId` keeps throwing, so this cannot widen access. The
  // WebSocket path binds each frame explicitly instead.
  if (scope === undefined) return;
  if (scope.workspaceId !== null && scope.workspaceId !== workspaceId) {
    throw new WorkspaceScopeError("the request scope is already bound to another workspace");
  }
  scope.workspaceId = workspaceId;
}

/** The workspace the current code runs for, or null when none is bound. */
export function boundWorkspaceId(): string | null {
  return storage.getStore()?.workspaceId ?? null;
}

let fallbackWorkspaceId: string | null = null;

/**
 * The feature-001 content harness builds the app without a security layer
 * and therefore without principals; it has exactly one workspace. Only that
 * composition may set a fallback. A secured app never does.
 */
export function setUnsecuredFallbackWorkspace(workspaceId: string | null): void {
  fallbackWorkspaceId = workspaceId;
}

export function currentWorkspaceId(): string {
  const bound = boundWorkspaceId();
  if (bound !== null) return bound;
  if (fallbackWorkspaceId !== null) return fallbackWorkspaceId;
  throw new WorkspaceScopeError("no workspace is bound to the current request");
}

/**
 * A stand-in that forwards every property to the instance of the current
 * workspace. Lets a route registered once keep calling `deps.operations.x()`
 * while each call lands in the right workspace's service.
 */
export function scoped<T extends object>(select: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = select();
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
    has(_target, property) {
      return Reflect.has(select(), property);
    },
  });
}
