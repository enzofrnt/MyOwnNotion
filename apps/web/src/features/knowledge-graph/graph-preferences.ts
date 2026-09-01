import type { GraphNodeKind } from "@myownnotion/graph";

const GRAPH_PREFERENCES_KEY = "myownnotion.graph.presentation.v1";
const NODE_KINDS = new Set<GraphNodeKind>(["page", "folder", "file", "database", "task"]);

export interface GraphPreferences {
  readonly mode: "canvas" | "list";
  readonly depth: 1 | 2 | 3;
  readonly nodeKinds: readonly GraphNodeKind[];
  readonly relationTypes: readonly string[];
  readonly includeIsolated: boolean;
  readonly zoom: number;
}

export const DEFAULT_GRAPH_PREFERENCES: GraphPreferences = {
  mode: "canvas",
  depth: 2,
  nodeKinds: [],
  relationTypes: [],
  includeIsolated: false,
  zoom: 1,
};

export function parseGraphPreferences(raw: string | null): GraphPreferences {
  if (raw === null) return DEFAULT_GRAPH_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const depth = Math.max(1, Math.min(3, Math.trunc(Number(value["depth"])))) as 1 | 2 | 3;
    const zoom = Math.max(0.5, Math.min(2, Number(value["zoom"]) || 1));
    const nodeKinds = Array.isArray(value["nodeKinds"])
      ? [
          ...new Set(
            value["nodeKinds"].filter((kind): kind is GraphNodeKind =>
              NODE_KINDS.has(kind as GraphNodeKind),
            ),
          ),
        ].slice(0, 5)
      : [];
    const relationTypes = Array.isArray(value["relationTypes"])
      ? [
          ...new Set(
            value["relationTypes"].filter(
              (type): type is string => typeof type === "string" && type.length <= 128,
            ),
          ),
        ]
          .toSorted()
          .slice(0, 32)
      : [];
    return {
      mode: value["mode"] === "list" ? "list" : "canvas",
      depth,
      nodeKinds,
      relationTypes,
      includeIsolated: value["includeIsolated"] === true,
      zoom,
    };
  } catch {
    return DEFAULT_GRAPH_PREFERENCES;
  }
}

export function serializeGraphPreferences(preferences: GraphPreferences): string {
  return JSON.stringify(parseGraphPreferences(JSON.stringify(preferences)));
}

export function readGraphPreferences(): GraphPreferences {
  if (typeof window === "undefined") return DEFAULT_GRAPH_PREFERENCES;
  const stored = window.localStorage.getItem(GRAPH_PREFERENCES_KEY);
  if (stored !== null) return parseGraphPreferences(stored);
  const prefersList =
    window.matchMedia("(max-width: 30rem)").matches ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return prefersList ? { ...DEFAULT_GRAPH_PREFERENCES, mode: "list" } : DEFAULT_GRAPH_PREFERENCES;
}

export function writeGraphPreferences(preferences: GraphPreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GRAPH_PREFERENCES_KEY, serializeGraphPreferences(preferences));
}
