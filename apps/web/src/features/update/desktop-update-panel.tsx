import { useEffect, useState } from "react";
import { localContent } from "../../services/local-content.ts";
import type { UpdateState } from "../../types/desktop-runtime.d.ts";
import { FR_COPY } from "../../ui/copy/fr.ts";
import { AsyncState, Button } from "../../ui/primitives/index.ts";

export function DesktopUpdatePanel() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const desktop = window.myownnotionDesktop;
  useEffect(() => {
    const desktop = window.myownnotionDesktop;
    if (!desktop) return;
    let live = true;
    const report = () => {
      const snapshot = localContent().getSnapshot();
      const pendingLocalChanges =
        snapshot.pendingCount + snapshot.filePendingCount + snapshot.recoveryPendingCount > 0;
      void desktop.update
        .context({ pendingLocalChanges })
        .then((value) => {
          if (live) setState(value);
        })
        .catch(() => {
          if (live) setError(true);
        });
    };
    report();
    const unsubscribe = localContent().subscribe(report);
    void desktop.update
      .check()
      .then((value) => {
        if (live) setState(value);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
      unsubscribe();
      void desktop.update.context({ pendingLocalChanges: true }).catch(() => {});
    };
  }, []);
  if (!desktop) return null;
  const copy = FR_COPY.desktop.update;
  const action = async (operation: () => Promise<UpdateState>) => {
    setBusy(true);
    setError(false);
    try {
      setState(await operation());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const canInstall =
    state &&
    ["available", "downloaded", "deferred", "download-failed", "install-failed"].includes(
      state.phase,
    );
  return (
    <section aria-label={copy.label} data-testid="desktop-update-panel" aria-busy={busy}>
      <h2>{copy.label}</h2>
      <p role="status" data-testid="desktop-update-phase" data-phase={state?.phase}>
        {state?.message ?? copy.idle}
      </p>
      {error ? (
        <AsyncState compact kind="error" title="La vérification a échoué. Vous pouvez réessayer." />
      ) : null}
      {state?.pendingLocalChanges ? (
        <AsyncState compact kind="error" title={copy.pendingChanges} />
      ) : null}
      <div>
        <Button disabled={busy} onClick={() => void action(desktop.update.check)}>
          Vérifier les mises à jour
        </Button>
        {canInstall ? (
          <>
            <Button disabled={busy} onClick={() => void action(desktop.update.defer)}>
              {copy.defer}
            </Button>
            <Button
              variant="primary"
              disabled={busy || state.pendingLocalChanges || state.migrationActive}
              onClick={() => void action(desktop.update.install)}
            >
              {busy ? "Vérification de l’installateur…" : copy.install}
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}
