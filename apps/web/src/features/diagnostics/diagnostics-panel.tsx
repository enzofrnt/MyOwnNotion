import type { SafeError } from "@myownnotion/domain";
import type { LocalContentService } from "../../services/local-content.ts";
import { StoragePanel } from "../files/storage-panel.tsx";
import { MutationStatus } from "../hierarchy/mutation-status.tsx";

export function DiagnosticsPanel({
  problem,
  service,
}: {
  readonly problem: SafeError | null;
  readonly service: LocalContentService;
}) {
  return (
    <section
      className="settings-local-data"
      aria-labelledby="local-data-heading"
      data-testid="diagnostics-panel"
    >
      <div>
        <h2 id="local-data-heading">Cet appareil</h2>
        <p className="muted">
          Ces informations détaillent le stockage local et les changements qui attendent le serveur.
          Elles restent séparées de vos notes.
        </p>
      </div>
      {problem === null ? null : (
        <section className="panel" aria-labelledby="operational-problem-heading">
          <h2 id="operational-problem-heading">Dernier incident</h2>
          <p>{problem.title}</p>
          <p className="muted" data-testid="operational-problem-code">
            Code : <code>{problem.code}</code>
          </p>
        </section>
      )}
      <StoragePanel service={service} />
      <MutationStatus service={service} />
    </section>
  );
}
