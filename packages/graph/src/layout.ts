import type { Uuid } from "@myownnotion/domain";
import type { GraphLayout, GraphLayoutPosition, GraphProjection } from "./types.ts";

const ITERATIONS = 72;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

interface MutablePosition {
  readonly id: Uuid;
  x: number;
  y: number;
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

function componentRoot(
  component: readonly Uuid[],
  projection: GraphProjection,
  adjacency: ReadonlyMap<Uuid, readonly Uuid[]>,
): Uuid {
  if (projection.focusId !== null && component.includes(projection.focusId)) {
    return projection.focusId;
  }
  return [...component].toSorted(
    (left, right) =>
      (adjacency.get(right) as readonly Uuid[]).length -
        (adjacency.get(left) as readonly Uuid[]).length || left.localeCompare(right),
  )[0] as Uuid;
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

function settleComponent(
  component: readonly Uuid[],
  projection: GraphProjection,
  center: { readonly x: number; readonly y: number },
  bounds: { readonly width: number; readonly height: number },
  adjacency: ReadonlyMap<Uuid, readonly Uuid[]>,
): ReadonlyMap<Uuid, MutablePosition> {
  const root = componentRoot(component, projection, adjacency);
  const ordered = [root, ...component.filter((id) => id !== root)];
  const positions = new Map<Uuid, MutablePosition>();
  ordered.forEach((id, index) => {
    if (index === 0) {
      positions.set(id, { id, x: center.x, y: center.y });
      return;
    }
    const angle = index * GOLDEN_ANGLE;
    const radius = Math.min(Math.min(bounds.width, bounds.height) * 0.38, 42 * Math.sqrt(index));
    positions.set(id, {
      id,
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  });
  if (component.length <= 1) return positions;

  const componentIds = new Set(component);
  const edges = projection.edges.filter(
    ({ sourceId, targetId }) => componentIds.has(sourceId) && componentIds.has(targetId),
  );
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const forces = new Map(component.map((id) => [id, { x: 0, y: 0 }] as const));
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      const left = positions.get(ordered[leftIndex] as Uuid) as MutablePosition;
      for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
        const right = positions.get(ordered[rightIndex] as Uuid) as MutablePosition;
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        const overlap = Number(Math.abs(dx) + Math.abs(dy) < 0.001);
        const separationAngle = (leftIndex + rightIndex + 1) * GOLDEN_ANGLE;
        dx += Math.cos(separationAngle) * overlap;
        dy += Math.sin(separationAngle) * overlap;
        const distanceSquared = Math.max(64, dx * dx + dy * dy);
        const distance = Math.sqrt(distanceSquared);
        const magnitude = 14_000 / distanceSquared;
        const forceX = (dx / distance) * magnitude;
        const forceY = (dy / distance) * magnitude;
        const leftForce = forces.get(left.id) as { x: number; y: number };
        const rightForce = forces.get(right.id) as { x: number; y: number };
        leftForce.x -= forceX;
        leftForce.y -= forceY;
        rightForce.x += forceX;
        rightForce.y += forceY;
      }
    }
    for (const edge of edges) {
      const source = positions.get(edge.sourceId) as MutablePosition;
      const target = positions.get(edge.targetId) as MutablePosition;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const magnitude = (distance - 132) * 0.028;
      const forceX = (dx / distance) * magnitude;
      const forceY = (dy / distance) * magnitude;
      const sourceForce = forces.get(source.id) as { x: number; y: number };
      const targetForce = forces.get(target.id) as { x: number; y: number };
      sourceForce.x += forceX;
      sourceForce.y += forceY;
      targetForce.x -= forceX;
      targetForce.y -= forceY;
    }
    const cooling = 1 - iteration / ITERATIONS;
    const maxStep = 1.5 + cooling * 9;
    for (const id of ordered) {
      const position = positions.get(id) as MutablePosition;
      const force = forces.get(id) as { x: number; y: number };
      const rootStrength = id === root ? 0.08 : 0.012;
      force.x += (center.x - position.x) * rootStrength;
      force.y += (center.y - position.y) * rootStrength;
      const length = Math.hypot(force.x, force.y);
      const factor = length > maxStep ? maxStep / length : 1;
      position.x = Math.max(
        center.x - bounds.width / 2 + 56,
        Math.min(center.x + bounds.width / 2 - 56, position.x + force.x * factor),
      );
      position.y = Math.max(
        center.y - bounds.height / 2 + 56,
        Math.min(center.y + bounds.height / 2 - 56, position.y + force.y * factor),
      );
    }
  }
  return positions;
}

/** Stable relation-driven layout; no randomness, timers or persisted coordinates. */
export function layoutGraph(projection: GraphProjection): GraphLayout {
  if (projection.nodes.length === 0) return { width: 800, height: 520, positions: [] };
  const { adjacency, components } = graphComponents(projection);
  const largest = Math.max(...components.map(({ length }) => length));
  const cellWidth = Math.max(680, Math.min(1_180, 430 + Math.sqrt(largest) * 54));
  const cellHeight = Math.max(540, Math.min(920, 360 + Math.sqrt(largest) * 44));
  const columns = Math.max(1, Math.ceil(Math.sqrt(components.length)));
  const rows = Math.ceil(components.length / columns);
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  const positions: GraphLayoutPosition[] = [];

  components.forEach((component, componentIndex) => {
    const center = {
      x: ((componentIndex % columns) + 0.5) * cellWidth,
      y: (Math.floor(componentIndex / columns) + 0.5) * cellHeight,
    };
    const root = componentRoot(component, projection, adjacency);
    const depths = depthsFrom(root, adjacency);
    const settled = settleComponent(
      component,
      projection,
      center,
      { width: cellWidth, height: cellHeight },
      adjacency,
    );
    for (const id of component) {
      const position = settled.get(id) as MutablePosition;
      const node = nodesById.get(id) as GraphProjection["nodes"][number];
      const incoming = node.incomingOccurrenceCount;
      positions.push({
        id,
        x: Math.round(position.x * 100) / 100,
        y: Math.round(position.y * 100) / 100,
        radius: Math.round((24 + Math.min(18, Math.sqrt(incoming) * 5)) * 100) / 100,
        depth: depths.get(id) as number,
        component: componentIndex,
      });
    }
  });

  return {
    width: Math.max(800, Math.round(columns * cellWidth)),
    height: Math.max(520, Math.round(rows * cellHeight)),
    positions: positions.toSorted((left, right) => left.id.localeCompare(right.id)),
  };
}
