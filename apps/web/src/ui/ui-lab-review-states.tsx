import { derivePageSyncState } from "@myownnotion/client-core";
import {
  type EditorDurableSession,
  EditorSyncStatus,
} from "../features/editor/editor-sync-status.tsx";
import { LocalCommitRecovery } from "../features/editor/local-commit-recovery.tsx";
import { MutationStatus } from "../features/hierarchy/mutation-status.tsx";
import { ConnectionState } from "../features/sync/connection-state.tsx";
import { PageContentSkeleton } from "../features/workspace/page-content-skeleton.tsx";
import { WorkspaceState } from "../features/workspace/workspace-state.tsx";
import type { LocalContentService } from "../services/local-content.ts";
import { Section } from "./primitives/index.ts";
import { reviewId } from "./ui-lab-review-fixtures.ts";

const session = {
  sync: derivePageSyncState({
    localCommit: "blocked",
    localBlockedReason: "quota",
    online: true,
    importingRemote: false,
    operationState: null,
    updates: [],
    ambiguities: [],
  }),
  subscribe: () => () => undefined,
  recoveryBuffer: { pageId: reviewId(42) },
  retryBlockedCommit: async () => undefined,
} as unknown as EditorDurableSession;
const queue = {
  subscribe: () => () => undefined,
  outbox: {
    all: async () => [
      {
        mutationId: reviewId(95),
        commandType: "page.document.replace",
        status: "pending",
        createdAt: "2026-10-03T10:00:00Z",
        lastAttemptAt: null,
      },
    ],
    activeConflicts: async () => [
      {
        mutationId: reviewId(96),
        commandType: "database.entry-values.replace",
        errorCode: "revision.stale-base",
        competingRevisionIds: [reviewId(12)],
      },
      {
        mutationId: reviewId(97),
        commandType: "item.move",
        errorCode: "item.cycle",
        competingRevisionIds: [],
      },
    ],
  },
} as unknown as LocalContentService;
export function ReviewStates() {
  return (
    <>
      <Section>
        <h2>Chargement du document</h2>
        <PageContentSkeleton />
      </Section>
      <Section>
        <h2>Espace de travail</h2>
        <WorkspaceState kind="loading" />
        <WorkspaceState kind="empty" />
        <WorkspaceState kind="offline" />
        <WorkspaceState kind="error" onRetry={() => undefined} />
      </Section>
      <Section>
        <h2>Enregistrement et connexion</h2>
        <EditorSyncStatus session={session} />
        <LocalCommitRecovery session={session} />
        {(["connecting", "live", "local", "revoked", "needs-update"] as const).map((state) => (
          <ConnectionState key={state} status={{ state, refusal: null }} />
        ))}
      </Section>
      <MutationStatus service={queue} />
    </>
  );
}
