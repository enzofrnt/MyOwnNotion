import { isUuid } from "@myownnotion/domain";
import { isProtectedDestination, recognizeDestination } from "./paths.ts";

const RETURN_PARAMETER = "returnTo";

export interface WorkspaceReturnDestination {
  readonly path: string;
  readonly scrollY: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeReturnDestination(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw === "" || !raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.includes("#")) return null;

  let candidate: URL;
  try {
    candidate = new URL(raw, "https://myownnotion.invalid");
  } catch {
    return null;
  }
  if (candidate.origin !== "https://myownnotion.invalid") return null;

  const destination = recognizeDestination(candidate.pathname);
  if (!isProtectedDestination(destination)) return null;

  const canonical = destination.canonicalPath;
  if (destination.kind !== "note") return canonical;
  const viewId = candidate.searchParams.get("view");
  return viewId !== null && isUuid(viewId) ? `${canonical}?view=${viewId}` : canonical;
}

function publicGatePath(pathname: "/login" | "/setup", returnTo?: string | null): string {
  const safeReturn = safeReturnDestination(returnTo);
  return safeReturn === null
    ? pathname
    : `${pathname}?${RETURN_PARAMETER}=${encodeURIComponent(safeReturn)}`;
}

export function loginPath(returnTo?: string | null): string {
  return publicGatePath("/login", returnTo);
}

export function setupPath(returnTo?: string | null): string {
  return publicGatePath("/setup", returnTo);
}

export function returnDestinationFromSearch(search: string): string | null {
  return safeReturnDestination(new URLSearchParams(search).get(RETURN_PARAMETER));
}

export function workspaceReturnState(
  path: string,
  scrollY: number,
): { readonly workspaceReturn: WorkspaceReturnDestination } | null {
  const safePath = safeReturnDestination(path);
  if (safePath === null) return null;
  return {
    workspaceReturn: {
      path: safePath,
      scrollY: Number.isFinite(scrollY) && scrollY >= 0 ? scrollY : 0,
    },
  };
}

export function workspaceReturnDestinationFromState(
  state: unknown,
): WorkspaceReturnDestination | null {
  if (!isRecord(state) || !isRecord(state["workspaceReturn"])) return null;
  const candidate = state["workspaceReturn"];
  const path =
    typeof candidate["path"] === "string" ? safeReturnDestination(candidate["path"]) : null;
  const scrollY = candidate["scrollY"];
  if (path === null || typeof scrollY !== "number" || !Number.isFinite(scrollY) || scrollY < 0) {
    return null;
  }
  return { path, scrollY };
}
