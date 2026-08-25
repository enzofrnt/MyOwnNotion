/** Conservative budgets for the smallest supported CI/development machine. */

export const REALTIME_REFERENCE_MACHINE = {
  logicalCpuFloor: 2,
  memoryFloorMiB: 7 * 1024,
  concurrentTestWorkers: 1,
} as const;

export const REALTIME_SYNC_BUDGETS = {
  /** Client construction, socket open and authenticated `ready`. */
  handshakeP95Ms: 100,
  /** In-process client overhead around one correlated durable response. */
  correlatedRoundTripP95Ms: 100,
  /** Parsing and coalescing a deliberately pathological notification storm. */
  tenThousandAnnouncementsMs: 2_000,
  /** Real encrypted PostgreSQL catch-up, enforced by page-operations.perf. */
  tenThousandUpdateCatchUpMs: 60_000,
  /** Shared ceiling for catch-up and notification-storm heap growth. */
  maxPeakHeapGrowthBytes: 512 * 1024 * 1024,
  /** User-visible cross-device target, measured in Playwright validation. */
  connectedVisibilityP95Ms: 2_000,
  /** Return-online to drain-start target, measured in browser journeys. */
  reconnectDrainStartP95Ms: 5_000,
} as const;

export function percentile(samples: readonly number[], quantile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.max(0, rank)] ?? 0;
}
