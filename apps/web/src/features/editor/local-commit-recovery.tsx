/**
 * What an owner sees when a local commit could not be made durable (T113).
 *
 * A blocked commit is not an error over lost work: what was typed stays on
 * screen, because the session kept it recoverable. This surface says exactly
 * three things — that nothing was lost, that durability failed, and the one
 * action that fixes it — and offers no destructive way out.
 */

import { useState } from "react";
import { AsyncState } from "../../ui/primitives/async-state.tsx";
import { Button } from "../../ui/primitives/button.tsx";
import type { EditorDurableSession } from "./editor-sync-status.tsx";

export function LocalCommitRecovery({ session }: { readonly session: EditorDurableSession }) {
  const [retrying, setRetrying] = useState(false);

  if (session.sync.synchronizationKind !== "blocked" || session.recoveryBuffer === null) {
    return null;
  }

  const retry = async () => {
    setRetrying(true);
    try {
      await session.retryBlockedCommit();
    } catch {
      // The session has already recorded the failure and updated the state
      // this component subscribes to; nothing further to say here.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <AsyncState
      compact
      kind="error"
      testId="recovery-buffer"
      title="Enregistrement local interrompu"
      description="Vos modifications restent affichées mais ne sont pas encore enregistrées sur cet appareil ; rien n’a été perdu."
      action={
        <Button
          type="button"
          variant="secondary"
          size="compact"
          data-testid="retry-blocked-commit"
          disabled={retrying}
          onClick={() => void retry()}
        >
          Réessayer l’enregistrement
        </Button>
      }
    />
  );
}
