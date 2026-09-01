import type { Uuid } from "@myownnotion/domain";
import type { GraphLayout, GraphLayoutPosition, GraphProjection } from "./types.ts";

/** Stable rings; no physics, randomness, timers or persisted coordinates. */
export function layoutGraph(projection: GraphProjection): GraphLayout {
  if (projection.nodes.length === 0) return { width: 800, height: 520, positions: [] };
  const adjacency = new Map<Uuid, Uuid[]>();
  for (const edge of projection.edges) {
    adjacency.set(edge.sourceId, [...(adjacency.get(edge.sourceId) ?? []), edge.targetId]);
    adjacency.set(edge.targetId, [...(adjacency.get(edge.targetId) ?? []), edge.sourceId]);
  }
  const nodeIds = new Set(projection.nodes.map(({ id }) => id));
  const remaining = new Set(nodeIds);
  const components: Uuid[][] = [];
  while (remaining.size > 0) {
    const start =
      projection.focusId !== null && remaining.has(projection.focusId)
        ? projection.focusId
        : ([...remaining].toSorted()[0] as Uuid);
    const members: Uuid[] = [];
    const queue = [start];
    remaining.delete(start);
    while (queue.length > 0) {
      const current = queue.shift() as Uuid;
      members.push(current);
      for (const neighbor of (adjacency.get(current) ?? []).toSorted()) {
        if (!remaining.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    components.push(members);
  }
  components.sort(
    (left, right) =>
      right.length - left.length || (left[0] as Uuid).localeCompare(right[0] as Uuid),
  );

  const positions: GraphLayoutPosition[] = [];
  const columns = Math.max(1, Math.ceil(Math.sqrt(components.length)));
  components.forEach((component, componentIndex) => {
    const first = component[0] as Uuid;
    const root =
      projection.focusId !== null && component.includes(projection.focusId)
        ? projection.focusId
        : first;
    const depth = new Map<Uuid, number>([[root, 0]]);
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift() as Uuid;
      for (const neighbor of (adjacency.get(current) ?? []).toSorted()) {
        if (!nodeIds.has(neighbor) || depth.has(neighbor)) continue;
        depth.set(neighbor, (depth.get(current) as number) + 1);
        queue.push(neighbor);
      }
    }
    const centerX = 320 + (componentIndex % columns) * 640;
    const centerY = 280 + Math.floor(componentIndex / columns) * 560;
    const levels = new Map<number, Uuid[]>();
    for (const id of component) {
      const level = depth.get(id) as number;
      levels.set(level, [...(levels.get(level) ?? []), id]);
    }
    for (const [level, ids] of [...levels.entries()].toSorted(([a], [b]) => a - b)) {
      const ordered = ids.toSorted();
      ordered.forEach((id, index) => {
        const angle = ordered.length === 1 ? -Math.PI / 2 : (2 * Math.PI * index) / ordered.length;
        const radius = level === 0 ? 0 : 135 * level;
        positions.push({
          id,
          x: Math.round((centerX + Math.cos(angle) * radius) * 100) / 100,
          y: Math.round((centerY + Math.sin(angle) * radius) * 100) / 100,
          depth: level,
          component: componentIndex,
        });
      });
    }
  });

  return {
    width: Math.max(800, columns * 640),
    height: Math.max(520, Math.ceil(components.length / columns) * 560),
    positions: positions.toSorted((left, right) => left.id.localeCompare(right.id)),
  };
}
