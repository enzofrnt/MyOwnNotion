import type { Uuid } from "@myownnotion/domain";
import {
  DEFAULT_GRAPH_FORCES,
  type GraphForceSettings,
  graphCenterGravity,
  graphRepelCharge,
  graphRepelRange,
} from "./forces.ts";
import type { GraphLayout, GraphLayoutPosition, GraphProjection } from "./types.ts";

/**
 * d3-force tick loop as used by Obsidian's graph view:
 * alpha += (target - alpha) * decay; many-body, links, forceX/Y, forceCenter;
 * then x += vx *= velocityDecay, unless fx/fy pin the node (drag).
 */
const SETTLE_TICKS = 120;
const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - ALPHA_MIN ** (1 / 300);
const VELOCITY_DECAY = 0.6;
const DISTANCE_MIN_SQ = 1;
const LINK_ITERATIONS = 1;
const COM_STRENGTH = 1;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const CANVAS_PADDING = 48;
const PHYLOTAXIS_RADIUS = 8;

interface SimNode {
  readonly id: Uuid;
  readonly index: number;
  readonly radius: number;
  readonly degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
}

interface SimLink {
  readonly source: SimNode;
  readonly target: SimNode;
  distance: number;
  strength: number;
  readonly bias: number;
}

export function graphNodeRadius(linkWeight: number): number {
  return Math.round(Math.min(13, 3.6 + Math.sqrt(Math.max(0, linkWeight)) * 1.85) * 100) / 100;
}

function separate(index: number): { readonly x: number; readonly y: number } {
  const angle = (index + 1) * GOLDEN_ANGLE;
  return { x: Math.cos(angle) * 1e-6, y: Math.sin(angle) * 1e-6 };
}

function graphComponents(projection: GraphProjection): {
  readonly adjacency: ReadonlyMap<Uuid, readonly Uuid[]>;
  readonly components: readonly Uuid[][];
} {
  const nodeIds = new Set(projection.nodes.map(({ id }) => id));
  const adjacency = new Map<Uuid, Set<Uuid>>();
  for (const id of nodeIds) adjacency.set(id, new Set());
  for (const edge of projection.edges) {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) continue;
    adjacency.get(edge.sourceId)?.add(edge.targetId);
    adjacency.get(edge.targetId)?.add(edge.sourceId);
  }
  const normalizedAdjacency = new Map(
    [...adjacency].map(([id, neighbors]) => [id, [...neighbors].toSorted()] as const),
  );
  const remaining = new Set(nodeIds);
  const components: Uuid[][] = [];
  while (remaining.size > 0) {
    const start = [...remaining].toSorted()[0] as Uuid;
    const members: Uuid[] = [];
    const queue = [start];
    remaining.delete(start);
    while (queue.length > 0) {
      const current = queue.shift() as Uuid;
      members.push(current);
      for (const neighbor of normalizedAdjacency.get(current) as readonly Uuid[]) {
        if (!remaining.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    components.push(members.toSorted());
  }
  components.sort(
    (left, right) =>
      right.length - left.length || (left[0] as Uuid).localeCompare(right[0] as Uuid),
  );
  return { adjacency: normalizedAdjacency, components };
}

function depthsFrom(
  root: Uuid,
  adjacency: ReadonlyMap<Uuid, readonly Uuid[]>,
): ReadonlyMap<Uuid, number> {
  const depths = new Map<Uuid, number>([[root, 0]]);
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift() as Uuid;
    for (const neighbor of adjacency.get(current) as readonly Uuid[]) {
      if (depths.has(neighbor)) continue;
      depths.set(neighbor, (depths.get(current) as number) + 1);
      queue.push(neighbor);
    }
  }
  return depths;
}

function applyCharge(
  nodes: readonly SimNode[],
  alpha: number,
  charge: number,
  maxDistSq: number,
): void {
  if (charge === 0) return;
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex] as SimNode;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex] as SimNode;
      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distSq = dx * dx + dy * dy;
      if (distSq > maxDistSq) continue;
      if (distSq < 1e-12) {
        const nudge = separate(left.index + right.index);
        dx = nudge.x;
        dy = nudge.y;
        distSq = dx * dx + dy * dy;
      }
      if (distSq < DISTANCE_MIN_SQ) distSq = Math.sqrt(DISTANCE_MIN_SQ * distSq);
      const weight = (charge * alpha) / distSq;
      left.vx += dx * weight;
      left.vy += dy * weight;
      right.vx -= dx * weight;
      right.vy -= dy * weight;
    }
  }
}

function applyLinks(links: readonly SimLink[], alpha: number): void {
  for (let pass = 0; pass < LINK_ITERATIONS; pass += 1) {
    for (const link of links) {
      let dx = link.target.x + link.target.vx - link.source.x - link.source.vx;
      let dy = link.target.y + link.target.vy - link.source.y - link.source.vy;
      if (dx === 0 && dy === 0) {
        const nudge = separate(link.source.index + link.target.index);
        dx = nudge.x;
        dy = nudge.y;
      }
      const distance = Math.sqrt(dx * dx + dy * dy);
      const scale = ((distance - link.distance) / distance) * alpha * link.strength;
      dx *= scale;
      dy *= scale;
      link.target.vx -= dx * link.bias;
      link.target.vy -= dy * link.bias;
      link.source.vx += dx * (1 - link.bias);
      link.source.vy += dy * (1 - link.bias);
    }
  }
}

/** d3.forceX(0)+forceY(0): pull toward the origin. This is Obsidian's center slider. */
function applyGravity(nodes: readonly SimNode[], alpha: number, strength: number): void {
  if (strength === 0) return;
  const pull = strength * alpha;
  for (const node of nodes) {
    node.vx -= node.x * pull;
    node.vy -= node.y * pull;
  }
}

/** d3.forceCenter: translate so the barycentre stays on the origin. Does not compact. */
function applyCenter(nodes: readonly SimNode[]): void {
  if (nodes.length === 0) return;
  let sx = 0;
  let sy = 0;
  for (const node of nodes) {
    sx += node.x;
    sy += node.y;
  }
  sx = (sx / nodes.length) * COM_STRENGTH;
  sy = (sy / nodes.length) * COM_STRENGTH;
  for (const node of nodes) {
    node.x -= sx;
    node.y -= sy;
  }
}

function integrate(nodes: readonly SimNode[]): void {
  for (const node of nodes) {
    if (node.fx === null) node.x += node.vx *= VELOCITY_DECAY;
    else {
      node.x = node.fx;
      node.vx = 0;
    }
    if (node.fy === null) node.y += node.vy *= VELOCITY_DECAY;
    else {
      node.y = node.fy;
      node.vy = 0;
    }
  }
}

function retuneLinks(links: readonly SimLink[], forces: GraphForceSettings): void {
  for (const link of links) {
    link.distance = forces.linkDistance;
    link.strength =
      forces.linkForce / Math.min(Math.max(1, link.source.degree), Math.max(1, link.target.degree));
  }
}

/** Obsidian starts nodes close together (forum: a springy “big bang”). */
function seedPhyllotaxis(nodes: readonly SimNode[]): void {
  const ordered = [...nodes].toSorted(
    (left, right) => right.degree - left.degree || left.id.localeCompare(right.id),
  );
  ordered.forEach((node, index) => {
    const radius = PHYLOTAXIS_RADIUS * Math.sqrt(0.5 + index);
    const angle = index * GOLDEN_ANGLE;
    node.x = Math.cos(angle) * radius;
    node.y = Math.sin(angle) * radius;
  });
}

function snapshotLayout(
  nodes: readonly SimNode[],
  componentOf: ReadonlyMap<Uuid, number>,
  depthsByComponent: ReadonlyMap<number, ReadonlyMap<Uuid, number>>,
): GraphLayout {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }
  if (!Number.isFinite(minX)) {
    return { width: 800, height: 520, positions: [] };
  }
  const positions: GraphLayoutPosition[] = nodes.map((node) => {
    const component = componentOf.get(node.id) ?? 0;
    const depths = depthsByComponent.get(component);
    return {
      id: node.id,
      x: Math.round(node.x * 100) / 100,
      y: Math.round(node.y * 100) / 100,
      radius: Math.round(node.radius * 100) / 100,
      depth: depths?.get(node.id) ?? 0,
      component,
    };
  });
  return {
    width: Math.max(1, Math.round(maxX - minX + CANVAS_PADDING * 2)),
    height: Math.max(1, Math.round(maxY - minY + CANVAS_PADDING * 2)),
    positions: positions.toSorted((left, right) => left.id.localeCompare(right.id)),
  };
}

export interface GraphForceRuntime {
  alpha: number;
  alphaTarget: number;
  tick(forces: GraphForceSettings): GraphLayout;
  settle(forces?: GraphForceSettings, ticks?: number): GraphLayout;
  pin(id: Uuid, x: number, y: number): void;
  unpin(id: Uuid): void;
  reheat(nextAlpha?: number): void;
  snapshot(): GraphLayout;
}

export function createGraphForceRuntime(projection: GraphProjection): GraphForceRuntime {
  if (projection.nodes.length === 0) {
    const empty = { width: 800, height: 520, positions: [] as const };
    return {
      alpha: 0,
      alphaTarget: 0,
      tick: () => empty,
      settle: () => empty,
      pin: () => undefined,
      unpin: () => undefined,
      reheat: () => undefined,
      snapshot: () => empty,
    };
  }

  const orderedNodes = [...projection.nodes].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );
  const degree = new Map<Uuid, number>(orderedNodes.map((node) => [node.id, 0]));
  const nodeIds = new Set(orderedNodes.map((node) => node.id));
  for (const edge of projection.edges) {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) continue;
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1);
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1);
  }

  const nodes: SimNode[] = orderedNodes.map((node, index) => ({
    id: node.id,
    index,
    radius: graphNodeRadius(degree.get(node.id) ?? 0),
    degree: degree.get(node.id) ?? 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    fx: null,
    fy: null,
  }));
  seedPhyllotaxis(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const { adjacency, components } = graphComponents(projection);
  const componentOf = new Map<Uuid, number>();
  components.forEach((component, index) => {
    for (const id of component) componentOf.set(id, index);
  });
  const depthsByComponent = new Map<number, ReadonlyMap<Uuid, number>>();
  components.forEach((component, index) => {
    const focus = projection.focusId;
    const root =
      focus !== null && component.includes(focus)
        ? focus
        : ([...component].toSorted(
            (left, right) =>
              (adjacency.get(right)?.length ?? 0) - (adjacency.get(left)?.length ?? 0) ||
              left.localeCompare(right),
          )[0] as Uuid);
    depthsByComponent.set(index, depthsFrom(root, adjacency));
  });

  const links: SimLink[] = [];
  const seen = new Set<string>();
  const sortedEdges = [...projection.edges].toSorted((left, right) => {
    const source = left.sourceId.localeCompare(right.sourceId);
    if (source !== 0) return source;
    const target = left.targetId.localeCompare(right.targetId);
    if (target !== 0) return target;
    return left.key.localeCompare(right.key);
  });
  for (const edge of sortedEdges) {
    const source = byId.get(edge.sourceId);
    const target = byId.get(edge.targetId);
    if (source === undefined || target === undefined) continue;
    const pair = [source.id, target.id].toSorted().join(":");
    if (seen.has(pair)) continue;
    seen.add(pair);
    const sourceDegree = Math.max(1, source.degree);
    const targetDegree = Math.max(1, target.degree);
    links.push({
      source,
      target,
      distance: DEFAULT_GRAPH_FORCES.linkDistance,
      strength: DEFAULT_GRAPH_FORCES.linkForce / Math.min(sourceDegree, targetDegree),
      bias: sourceDegree / (sourceDegree + targetDegree),
    });
  }

  const runtime: GraphForceRuntime = {
    alpha: 1,
    alphaTarget: 0,
    tick(forces: GraphForceSettings): GraphLayout {
      runtime.alpha += (runtime.alphaTarget - runtime.alpha) * ALPHA_DECAY;
      retuneLinks(links, forces);
      const range = graphRepelRange(forces.linkDistance);
      applyCharge(
        nodes,
        runtime.alpha,
        graphRepelCharge(forces.repelForce, forces.linkDistance),
        range * range,
      );
      applyLinks(links, runtime.alpha);
      applyGravity(nodes, runtime.alpha, graphCenterGravity(forces.centerForce));
      applyCenter(nodes);
      integrate(nodes);
      return snapshotLayout(nodes, componentOf, depthsByComponent);
    },
    settle(forces: GraphForceSettings = DEFAULT_GRAPH_FORCES, ticks = SETTLE_TICKS): GraphLayout {
      runtime.alpha = 1;
      runtime.alphaTarget = 0;
      let layout = snapshotLayout(nodes, componentOf, depthsByComponent);
      for (let tick = 0; tick < ticks; tick += 1) {
        layout = runtime.tick(forces);
      }
      return layout;
    },
    pin(id, x, y) {
      const node = byId.get(id);
      if (node === undefined) return;
      node.fx = x;
      node.fy = y;
      node.x = x;
      node.y = y;
      node.vx = 0;
      node.vy = 0;
    },
    unpin(id) {
      const node = byId.get(id);
      if (node === undefined) return;
      node.fx = null;
      node.fy = null;
    },
    reheat(nextAlpha = 1) {
      runtime.alpha = Math.max(runtime.alpha, nextAlpha);
    },
    snapshot: () => snapshotLayout(nodes, componentOf, depthsByComponent),
  };
  return runtime;
}

export function layoutGraph(
  projection: GraphProjection,
  forces: GraphForceSettings = DEFAULT_GRAPH_FORCES,
): GraphLayout {
  return createGraphForceRuntime(projection).settle(forces, SETTLE_TICKS);
}
