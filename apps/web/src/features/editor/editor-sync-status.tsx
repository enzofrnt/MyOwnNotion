/**
 * The honest page-level status line for a session-driven editor (T112, FR-026).
 *
 * Every word is derived from the session's own durable state, so the sentence
 * and the reality cannot disagree. Two claims are kept apart on purpose:
 * « enregistré sur cet appareil » means an encrypted transaction was committed
 * to IndexedDB; « synchronisé » means the server confirmed the causal
 * frontier. Neither is ever shown before its proof exists.
 */

import type {
  LegacyPageEditingSession,
  PageEditingSession,
  PageSyncState,
} from "@myownnotion/client-core";
import { useEffect, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { LocalCommitRecovery } from "./local-commit-recovery.tsx";

export const BLOCKED_REASON_COPY: Record<PageSyncState["blockedReason"] & string, string> = {
  quota: "le stockage de cet appareil est plein",
  key: "la clé de chiffrement de cet appareil est indisponible",
  protocol: "la version du protocole de synchronisation n’est pas compatible",
  revocation: "cet appareil n’est plus autorisé à synchroniser cette page",
  validation: "une modification n’a pas passé la validation du modèle",
  integrity: "une vérification d’intégrité locale a échoué",
  operation: "une opération de cette page est bloquée côté serveur",
  storage: "le stockage local n’a pas pu écrire la modification",
};

export function editorSyncLabel(sync: PageSyncState): string {
  switch (sync.kind) {
    case "local-saving":
      return "Enregistrement…";
    case "local-saved":
      return "Enregistré sur cet appareil";
    case "pending":
      return sync.pendingCount > 1
        ? `Enregistré sur cet appareil — ${sync.pendingCount} modifications en attente d’envoi`
        : "Enregistré sur cet appareil — en attente d’envoi";
    case "syncing":
      return "Synchronisation…";
    case "synced":
      return "Synchronisé";
    case "offline":
      return "Enregistré sur cet appareil — hors ligne, envoi au retour du réseau";
    case "attention":
      return sync.attentionCount > 1
        ? `Décision requise — ${sync.attentionCount} ambiguïtés à résoudre`
        : "Décision requise — une ambiguïté à résoudre";
    case "blocked":
      return "Enregistrement interrompu";
  }
}

export type EditorDurableSession = PageEditingSession | LegacyPageEditingSession;

export function EditorSyncStatus({
  session,
  editorSettled = true,
}: {
  readonly session: EditorDurableSession;
  /** False while visible browser input has not reached durable page storage yet. */
  readonly editorSettled?: boolean;
}) {
  const [sync, setSync] = useState<PageSyncState>(session.sync);
  const remoteAdoptionErrorType =
    "remoteAdoptionErrorType" in session ? session.remoteAdoptionErrorType : null;
  const importingRemote = "importingRemote" in session && session.importingRemote;

  useEffect(
    () =>
      session.subscribe((change: { readonly sync: PageSyncState }) => {
        setSync(change.sync);
      }),
    [session],
  );

  // BlockNote publishes its change after the browser has already painted the
  // input. During that short hand-off the session can still report its
  // previous durable frontier. Never let that stale state acknowledge the new
  // visible text: the editor settlement boundary must be crossed as well.
  const editorCommitPending = !editorSettled && sync.synchronizationKind !== "blocked";
  const displayedKind = editorCommitPending ? "local-saving" : sync.kind;
  const displayedSynchronizationKind = editorCommitPending
    ? "local-saving"
    : sync.synchronizationKind;
  const displayedLocallyDurable = !editorCommitPending && sync.locallyDurable;
  const label = editorCommitPending ? "Enregistrement…" : editorSyncLabel(sync);
  const requiresAction = displayedSynchronizationKind === "blocked" || sync.kind === "attention";

  return (
    <div
      className="editor-sync-status"
      data-testid="editor-sync-control"
      data-placement="viewport-bottom"
      data-requires-action={requiresAction || undefined}
    >
      <details>
        <summary title={`${label} — afficher les détails`}>
          <AppIcon name={requiresAction ? "conflict" : "info"} size="small" />
          <span
            className="editor-sync-status__label"
            data-testid="editor-sync-status"
            data-state={displayedKind}
            data-sync={displayedSynchronizationKind}
            data-durable={displayedLocallyDurable ? "true" : "false"}
            data-pending-count={sync.pendingCount}
            data-attention-count={sync.attentionCount}
            data-adoption-error={remoteAdoptionErrorType ?? undefined}
            data-importing-remote={importingRemote ? "true" : "false"}
            role="status"
            aria-live="polite"
          >
            <strong data-testid="editor-sync-label">{label}</strong>
          </span>
        </summary>
        <div className="editor-sync-status__details">
          <p>{label}</p>
          {sync.blockedReason !== undefined ? (
            <p data-testid="editor-sync-blocked-reason">
              {BLOCKED_REASON_COPY[sync.blockedReason]}
            </p>
          ) : null}
          <LocalCommitRecovery session={session} />
        </div>
      </details>
    </div>
  );
}
