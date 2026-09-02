import {
  DEFAULT_GRAPH_FORCES,
  type GraphEdgeLayer,
  type GraphForceSettings,
  type GraphNodeKind,
  parseGraphForceSettings,
} from "@myownnotion/graph";

const GRAPH_PREFERENCES_KEY = "myownnotion.graph.presentation.v1";
const NODE_KINDS = new Set<GraphNodeKind>(["page", "folder", "file", "database", "task"]);
const EDGE_LAYERS = new Set<GraphEdgeLayer>(["knowledge", "hierarchy", "attachment"]);

export interface GraphPreferences {
  readonly depth: 1 | 2 | 3;
  readonly edgeLayers: readonly GraphEdgeLayer[];
  readonly nodeKinds: readonly GraphNodeKind[];
  readonly relationTypes: readonly string[];
  readonly includeIsolated: boolean;
  readonly zoom: number;
  readonly forces: GraphForceSettings;
}

export const DEFAULT_GRAPH_PREFERENCES: GraphPreferences = {
  depth: 2,
  edgeLayers: ["knowledge"],
  nodeKinds: [],
  relationTypes: [],
  includeIsolated: false,
  zoom: 1,
  forces: DEFAULT_GRAPH_FORCES,
};

export function parseGraphPreferences(raw: string | null): GraphPreferences {
  if (raw === null) return DEFAULT_GRAPH_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const parsedDepth = Math.trunc(Number(value["depth"]));
    const depth = (
      Number.isFinite(parsedDepth) ? Math.max(1, Math.min(3, parsedDepth)) : 2
    ) as 1 | 2 | 3;
    const zoomValue = Number(value["zoom"]);
    const zoom = Number.isFinite(zoomValue) && zoomValue >= 0.01 ? Math.min(4, zoomValue) : 1;
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
    const edgeLayers = Array.isArray(value["edgeLayers"])
      ? [
          ...new Set(
            value["edgeLayers"].filter((layer): layer is GraphEdgeLayer =>
              EDGE_LAYERS.has(layer as GraphEdgeLayer),
            ),
          ),
        ].toSorted()
      : ["knowledge" as const];
    return {
      depth,
      edgeLayers,
      nodeKinds,
      relationTypes,
      includeIsolated: value["includeIsolated"] === true,
      zoom,
      forces: parseGraphForceSettings(value["forces"]),
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
  return parseGraphPreferences(window.localStorage.getItem(GRAPH_PREFERENCES_KEY));
}

export function writeGraphPreferences(preferences: GraphPreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GRAPH_PREFERENCES_KEY, serializeGraphPreferences(preferences));
}
