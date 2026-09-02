/**
 * Obsidian graph.json sliders, mapped onto d3-force.
 *
 * Staff (2020) and living-graph: the engine exposes centerStrength,
 * repelStrength, linkStrength, linkDistance. Official help: center force
 * controls compactness and circularity — that is d3.forceX/forceY toward the
 * origin, not forceCenter (which only translates the barycentre and cannot
 * stop a Coulomb expansion).
 */
export interface GraphForceSettings {
  readonly centerForce: number;
  readonly repelForce: number;
  readonly linkForce: number;
  readonly linkDistance: number;
}

export const DEFAULT_GRAPH_FORCES: GraphForceSettings = {
  centerForce: 0.5,
  repelForce: 10,
  linkForce: 1,
  linkDistance: 250,
};

export const GRAPH_FORCE_RANGES = {
  centerForce: { min: 0, max: 1, step: 0.01, digits: 2 },
  repelForce: { min: 0, max: 20, step: 0.01, digits: 2 },
  linkForce: { min: 0, max: 1, step: 0.01, digits: 2 },
  linkDistance: { min: 30, max: 500, step: 1, digits: 0 },
} as const;

/** d3.forceX default is ~0.1; slider 0.5 maps onto that. */
const CENTER_TO_GRAVITY = 0.14;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function readForce(record: Record<string, unknown>, key: keyof GraphForceSettings): number {
  const range = GRAPH_FORCE_RANGES[key];
  if (record[key] === undefined) return DEFAULT_GRAPH_FORCES[key];
  return clamp(Number(record[key]), range.min, range.max);
}

export function parseGraphForceSettings(value: unknown): GraphForceSettings {
  const record =
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    centerForce: readForce(record, "centerForce"),
    repelForce: readForce(record, "repelForce"),
    linkForce: readForce(record, "linkForce"),
    linkDistance: readForce(record, "linkDistance"),
  };
}

export function graphCenterGravity(centerForce: number): number {
  return centerForce * CENTER_TO_GRAVITY;
}

/**
 * Coulomb charge so unlinked spacing sits near `linkDistance` at the default
 * center slider: r ≈ sqrt(|charge| / gravity).
 */
export function graphRepelCharge(repelForce: number, linkDistance: number): number {
  const gravity = graphCenterGravity(DEFAULT_GRAPH_FORCES.centerForce);
  const rest = Math.max(1, linkDistance);
  return -rest * rest * gravity * (repelForce / DEFAULT_GRAPH_FORCES.repelForce);
}

export function graphRepelRange(linkDistance: number): number {
  return Math.max(1, linkDistance) * 2;
}

export function formatGraphForceValue(key: keyof GraphForceSettings, value: number): string {
  const digits = GRAPH_FORCE_RANGES[key].digits;
  return value.toFixed(digits);
}
