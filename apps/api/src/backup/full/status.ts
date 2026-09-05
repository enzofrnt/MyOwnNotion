import type { FullBackupStatus } from "@myownnotion/contracts";
import { backupIsStale, UNKNOWN_SOURCE_VERSION } from "@myownnotion/domain";
import type { FullBackupActivity } from "./activity.ts";
import type { FullBackupService } from "./service.ts";

function outcome(activity: FullBackupActivity | null): FullBackupStatus["latestAttemptOutcome"] {
  return activity?.outcome === "running" ? "unfinished" : (activity?.outcome ?? null);
}

export async function fullBackupStatus(
  service: FullBackupService,
  now = new Date(),
): Promise<FullBackupStatus> {
  const [receipts, attempt, rehearsal] = await Promise.all([
    service.verifiedReceipts(1),
    service.activities.read("backup"),
    service.activities.read("rehearsal"),
  ]);
  const latest = receipts[0];
  return {
    lastVerifiedAt: latest?.verifiedAt ?? null,
    lastVerifiedBackupId: latest?.backupId ?? null,
    sourceVersion: latest?.sourceVersion ?? null,
    sourceVersionLabel: latest?.sourceVersion ?? UNKNOWN_SOURCE_VERSION,
    remote: latest?.remote ?? null,
    remoteVerifiedAt: latest?.remoteVerifiedAt ?? null,
    latestAttemptAt: attempt?.startedAt ?? null,
    latestAttemptOutcome: outcome(attempt),
    lastRehearsalAt: rehearsal?.finishedAt ?? rehearsal?.startedAt ?? null,
    lastRehearsalOutcome: outcome(rehearsal),
    stale: backupIsStale(latest === undefined ? null : new Date(latest.verifiedAt), now),
    rehearsalDue:
      rehearsal?.outcome !== "succeeded" ||
      rehearsal.finishedAt === null ||
      now.getTime() - Date.parse(rehearsal.finishedAt) > 31 * 86_400_000,
  };
}
