/**
 * Acceptance fixtures (T016): deterministic workspace builders used by
 * integration, performance, and export suites (10,000-item hierarchy,
 * 100-placement file, mixed containment).
 */
import { generateUuidV7, keyBetween, type Uuid } from "@myownnotion/domain";

export * from "./databases.ts";
export * from "./knowledge.ts";
export * from "./tasks.ts";

export interface FixtureItem {
  readonly id: Uuid;
  readonly kind: "page" | "folder";
  readonly name: string;
  readonly parentItemId: Uuid | null;
  readonly positionKey: string;
}

/**
 * Builds a deterministic mixed hierarchy of `count` pages/folders with the
 * requested branching factor. Iterative construction: no recursion limits.
 */
export function buildHierarchyFixture(count: number, branchingFactor = 8): FixtureItem[] {
  const fixtures: FixtureItem[] = [];
  const parents: Array<Uuid | null> = [null];
  const lastKeyByParent = new Map<string, string | null>();

  for (let index = 0; index < count; index += 1) {
    const parentIndex = Math.floor(index / branchingFactor);
    const parentItemId = parents[parentIndex] ?? null;
    const parentKey = parentItemId ?? "root";
    const previousKey = lastKeyByParent.get(parentKey) ?? null;
    const positionKey = keyBetween(previousKey, null);
    lastKeyByParent.set(parentKey, positionKey);

    const id = generateUuidV7();
    fixtures.push({
      id,
      kind: index % 3 === 0 ? "folder" : "page",
      name: `Item ${index}`,
      parentItemId,
      positionKey,
    });
    parents.push(id);
  }
  return fixtures;
}

/** Resets the sibling key tracker (useful between fixture builds). */
export function resetFixtureState(): void {
  // Builders are pure per call; nothing global is retained.
}

/** Deterministic byte payloads for file-content fixtures. */
export function fixtureBytes(seed: string, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let acc = 0;
  for (let i = 0; i < seed.length; i += 1) {
    acc = (acc * 31 + seed.charCodeAt(i)) >>> 0;
  }
  for (let i = 0; i < length; i += 1) {
    acc = (acc * 1103515245 + 12345) >>> 0;
    bytes[i] = acc & 0xff;
  }
  return bytes;
}
