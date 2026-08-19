import type { WorkspaceSearchIndex } from "@myownnotion/domain";

export type SearchStateName = "cold" | "building" | "ready" | "degraded";

export interface SearchStateView {
  readonly state: SearchStateName;
  readonly generation: number | null;
  readonly indexedCount: number;
  readonly expectedCount: number;
  readonly failureCode: string | null;
}

export class SearchState {
  #state: SearchStateName = "cold";
  #generation = 0;
  #indexedCount = 0;
  #expectedCount = 0;
  #failureCode: string | null = null;
  #active: WorkspaceSearchIndex | null = null;

  beginBuild(expectedCount = 0): void {
    this.#state = "building";
    this.#indexedCount = 0;
    this.#expectedCount = expectedCount;
    this.#failureCode = null;
  }

  setExpectedCount(expectedCount: number): void {
    this.#expectedCount = expectedCount;
  }

  recordIndexed(indexedCount: number): void {
    this.#indexedCount = indexedCount;
  }

  publish(index: WorkspaceSearchIndex): number {
    this.#active = index;
    this.#generation += 1;
    this.#indexedCount = index.size;
    this.#expectedCount = index.size;
    this.#failureCode = null;
    this.#state = "ready";
    return this.#generation;
  }

  /** Records an incremental mutation of the active in-memory generation. */
  markActiveUpdated(): number | null {
    if (this.#active === null) {
      return null;
    }
    this.#generation += 1;
    if (this.#state !== "building") {
      this.#state = "ready";
      this.#indexedCount = this.#active.size;
      this.#expectedCount = this.#active.size;
      this.#failureCode = null;
    }
    return this.#generation;
  }

  degrade(failureCode: string): void {
    this.#active = null;
    this.#state = "degraded";
    this.#failureCode = failureCode;
  }

  active(): { readonly index: WorkspaceSearchIndex; readonly generation: number } | null {
    return this.#active === null ? null : { index: this.#active, generation: this.#generation };
  }

  view(): SearchStateView {
    return {
      state: this.#state,
      generation: this.#generation === 0 ? null : this.#generation,
      indexedCount: this.#indexedCount,
      expectedCount: this.#expectedCount,
      failureCode: this.#failureCode,
    };
  }
}
