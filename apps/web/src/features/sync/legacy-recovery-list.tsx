import type {
  ConflictRecordRow,
  LegacySyncRecoveryReasonCode,
  LegacySyncRecoveryRow,
} from "@myownnotion/client-core";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { Button } from "../../ui/primitives/index.ts";

const REASON_COPY: Record<LegacySyncRecoveryReasonCode, string> = {
  "legacy-recovery.payload-unreadable":
    "Le brouillon chiffré ne peut pas être lu avec la clé locale actuelle.",
  "legacy-recovery.base-unavailable":
    "La version de départ nécessaire à une fusion vérifiable n’est pas disponible.",
  "legacy-recovery.schema-unsupported":
    "Le format de ce brouillon n’est pas pris en charge par le convertisseur sûr.",
  "legacy-recovery.diff-unprovable":
    "Le brouillon ne peut pas être reconstruit exactement par les opérations connues.",
  "legacy-recovery.item-not-page": "La page d’origine n’existe plus comme page éditable.",
  "legacy-recovery.server-item-missing":
    "La page n’existe plus sur ce serveur. Le brouillon local complet a été conservé.",
  "legacy-recovery.integrity-failed":
    "Les preuves locales de conversion sont incomplètes ou incohérentes.",
};

interface ListedRecovery {
  readonly row: LegacySyncRecoveryRow;
  readonly pageName: string | null;
}

export interface LegacyDraftExport {
  readonly format: "myownnotion.legacy-draft-export+json";
  readonly formatVersion: 1;
  readonly mutationId: string;
  readonly pageId: string | null;
  readonly capturedAt: string;
  readonly reasonCode: LegacySyncRecoveryReasonCode | null;
  readonly document: unknown;
}

export function legacyDraftExport(
  row: LegacySyncRecoveryRow,
  conflict: ConflictRecordRow,
): LegacyDraftExport | null {
  const document = conflict.payload["document"];
  if (document === null || typeof document !== "object" || Array.isArray(document)) return null;
  return {
    format: "myownnotion.legacy-draft-export+json",
    formatVersion: 1,
    mutationId: row.mutationId,
    pageId: row.pageId,
    capturedAt: row.capturedAt,
    reasonCode: row.reasonCode,
    document: structuredClone(document),
  };
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function LegacyRecoveryList({ service }: { readonly service: LocalContentService }) {
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );
  const [recoveries, setRecoveries] = useState<readonly ListedRecovery[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const quarantinedRecoveryCount = snapshot.quarantinedRecoveryCount;

  useEffect(() => {
    if (quarantinedRecoveryCount === 0) {
      setRecoveries([]);
      return;
    }
    let cancelled = false;
    void service.legacyConflictRecovery.list(["quarantined"]).then(async (rows) => {
      const listed = await Promise.all(
        rows.map(async (row) => ({
          row,
          pageName:
            row.pageId === null ? null : ((await service.getItem(row.pageId))?.name ?? null),
        })),
      );
      if (!cancelled) setRecoveries(listed);
    });
    return () => {
      cancelled = true;
    };
  }, [quarantinedRecoveryCount, service]);

  const exportRecovery = async (row: LegacySyncRecoveryRow): Promise<void> => {
    setProblem(null);
    setExporting(row.mutationId);
    try {
      const conflict = await service.legacyConflictRecovery.retainedConflict(row.mutationId);
      const exported = conflict === null ? null : legacyDraftExport(row, conflict);
      if (exported === null) {
        setProblem(
          "Ce brouillon ne peut pas être déchiffré automatiquement. Conservez ce profil de navigateur et sa clé locale.",
        );
        return;
      }
      downloadJson(`myownnotion-brouillon-${row.mutationId}.json`, exported);
    } finally {
      setExporting(null);
    }
  };

  return (
    <section className="panel" aria-labelledby="legacy-recovery-heading">
      <h2 id="legacy-recovery-heading">Anciens brouillons récupérables</h2>
      <p className="muted">
        Ils ne bloquent pas la synchronisation actuelle. MyOwnNotion les conserve ici lorsqu’une
        fusion exacte ne peut pas être prouvée.
      </p>
      {problem === null ? null : (
        <p className="status-banner" data-state="attention" role="alert">
          {problem}
        </p>
      )}
      {recoveries.length === 0 ? (
        <p className="muted" data-testid="legacy-recovery-empty">
          Aucun ancien brouillon ne demande d’intervention.
        </p>
      ) : (
        <ul className="tree" data-testid="legacy-recovery-list">
          {recoveries.map(({ row, pageName }) => (
            <li className="tree-row" key={row.mutationId}>
              <span className="tree-name">
                <strong>{pageName ?? "Page locale non identifiée"}</strong>
                <span className="muted">
                  {new Date(row.capturedAt).toLocaleString("fr-FR")} —{" "}
                  {row.reasonCode === null
                    ? "Preuve de conversion manquante."
                    : REASON_COPY[row.reasonCode]}
                </span>
              </span>
              <Button
                size="compact"
                busy={exporting === row.mutationId}
                disabled={exporting !== null && exporting !== row.mutationId}
                onClick={() => void exportRecovery(row)}
              >
                Exporter le brouillon
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
