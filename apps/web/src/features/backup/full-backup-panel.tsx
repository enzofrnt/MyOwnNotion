import type { FullBackupStatus } from "@myownnotion/contracts";
import { useEffect, useRef, useState } from "react";
import { AsyncState, Button, formatDateTime } from "../../ui/index.ts";

function moment(value: string | null): string {
  return value === null ? "Jamais" : formatDateTime(new Date(value));
}

export function FullBackupPanel({
  load,
  runRehearsal,
}: {
  readonly load: () => Promise<FullBackupStatus>;
  readonly runRehearsal: () => Promise<void>;
}) {
  const [status, setStatus] = useState<FullBackupStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [run, setRun] = useState<"idle" | "running" | "succeeded" | "failed">("idle");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let current = true;
    void load().then(
      (value) => {
        if (current) {
          setStatus(value);
          setLoadFailed(false);
        }
      },
      () => {
        if (current) setLoadFailed(true);
      },
    );
    return () => {
      current = false;
      mounted.current = false;
    };
  }, [load]);

  const rehearse = async () => {
    if (run === "running") return;
    setRun("running");
    try {
      await runRehearsal();
      if (!mounted.current) return;
      setRun("succeeded");
      try {
        const next = await load();
        if (mounted.current) setStatus(next);
      } catch {
        /* The rehearsal really succeeded even if the status read fails. */
      }
    } catch {
      if (mounted.current) setRun("failed");
    }
  };

  return (
    <section
      className="ui-settings-panel full-backup-panel"
      aria-labelledby="full-backup-title"
      data-testid="full-backup-panel"
    >
      <h2 id="full-backup-title">Sauvegarde complète du serveur</h2>
      <p className="muted">
        Toutes les données de la base et les fichiers sont copiés ensemble, chaque nuit et avant les
        migrations. Conservez le fichier de clé de déploiement séparément : il est nécessaire à la
        restauration.
      </p>
      {status === null ? (
        <AsyncState
          kind={loadFailed ? "error" : "loading"}
          title={
            loadFailed
              ? "Le statut des sauvegardes complètes est indisponible."
              : "Vérification des sauvegardes complètes…"
          }
        />
      ) : (
        <>
          <AsyncState
            kind={status.stale ? "error" : "success"}
            title={
              status.stale
                ? "Aucune sauvegarde complète vérifiée au cours des 26 dernières heures."
                : "Une copie complète récente est vérifiée sur le serveur."
            }
            description={`Dernière vérification : ${moment(status.lastVerifiedAt)}.`}
            testId="full-backup-local-status"
          />
          {status.lastVerifiedBackupId === null ? null : (
            <p>
              Version d’origine :{" "}
              <strong data-testid="full-backup-source-version">{status.sourceVersionLabel}</strong>.
            </p>
          )}
          {status.latestAttemptOutcome === "failed" ||
          status.latestAttemptOutcome === "unfinished" ? (
            <AsyncState
              kind="error"
              title={
                status.latestAttemptOutcome === "failed"
                  ? "La dernière tentative de sauvegarde a échoué."
                  : "Une tentative de sauvegarde n’a pas enregistré de résultat."
              }
              description="Les copies déjà vérifiées sont conservées. Le serveur retente les sauvegardes manquées."
              testId="full-backup-attempt"
            />
          ) : null}
          <section aria-labelledby="full-backup-remote-title">
            <h3 id="full-backup-remote-title">Copie distante</h3>
            {status.remote === "verified" ? (
              <p role="status">Copie distante vérifiée le {moment(status.remoteVerifiedAt)}.</p>
            ) : status.remote === "failed" || status.remote === "pending" ? (
              <AsyncState
                kind="pending"
                title="La copie distante reste à vérifier."
                description="La copie complète locale est conservée. Le transfert sera retenté automatiquement."
                testId="full-backup-remote-pending"
              />
            ) : (
              <p className="muted">
                {status.remote === "not-configured"
                  ? "Aucune copie distante n’est configurée. La copie locale ne protège pas contre la perte du serveur."
                  : "Aucune copie complète distante vérifiée n’est disponible."}
              </p>
            )}
          </section>
          <section aria-labelledby="full-backup-rehearsal-title">
            <h3 id="full-backup-rehearsal-title">Vérifier la restauration</h3>
            <p className="muted">
              Un essai restaure la base et les fichiers dans un espace temporaire isolé. Vos données
              en cours restent en place.
            </p>
            <p>
              Dernier essai : {moment(status.lastRehearsalAt)}
              {status.lastRehearsalOutcome === null
                ? ""
                : ` — ${status.lastRehearsalOutcome === "succeeded" ? "réussi" : status.lastRehearsalOutcome === "failed" ? "échec" : "sans résultat confirmé"}`}
              .
            </p>
            <Button
              accessibleWhenDisabled={status.lastVerifiedBackupId !== null}
              onClick={() => {
                void rehearse();
              }}
              busy={run === "running"}
              disabled={status.lastVerifiedBackupId === null}
              data-testid="run-full-rehearsal"
            >
              Tester la restauration complète
            </Button>
            {status.lastVerifiedBackupId === null ? (
              <p className="muted">
                Une sauvegarde complète vérifiée est nécessaire pour lancer cet essai.
              </p>
            ) : null}
            {run === "succeeded" ? (
              <AsyncState
                kind="success"
                title="La restauration complète a réussi dans l’espace temporaire."
                testId="full-rehearsal-result"
              />
            ) : run === "failed" ? (
              <AsyncState
                kind="error"
                title="La restauration complète n’a pas pu être vérifiée."
                description="Vos données en cours restent intactes. Vous pouvez relancer l’essai."
                testId="full-rehearsal-result"
              />
            ) : run === "running" ? (
              <p role="status">Restauration et vérification des fichiers en cours…</p>
            ) : null}
          </section>
        </>
      )}
    </section>
  );
}
