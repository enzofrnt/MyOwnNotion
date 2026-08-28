/**
 * A decision the owner must make, stated recoverably (T152, FR-058).
 *
 * An open ambiguity means two of the owner's intentions collided and both
 * survive. The notice says that in one line; the resolution surface shows
 * what each side holds and offers exactly the three outcomes the contract
 * defines — nothing is deleted until the owner says so, and confirming a
 * deletion is itself reversible through history.
 */

import type { PageAmbiguityRecord } from "@myownnotion/client-core";
import { useState } from "react";
import { FR_COPY } from "../../ui/copy/fr.ts";
import { AsyncState } from "../../ui/primitives/async-state.tsx";
import { Button } from "../../ui/primitives/button.tsx";

const KIND_LABELS: Record<PageAmbiguityRecord["kind"], string> = {
  "delete-edit": "Suppression contre modification",
  "delete-move": "Suppression contre déplacement",
  "type-transform": "Transformations incompatibles",
  "property-transform": "Propriétés incompatibles",
  schema: "Schéma non pris en charge",
};

export function PageAmbiguityNotice({
  records,
  onResolve,
}: {
  readonly records: readonly PageAmbiguityRecord[];
  readonly onResolve?: (ambiguityId: string, decision: "confirm-delete" | "restore-change") => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (records.length === 0) return null;
  const expanded = records.find((record) => record.ambiguityId === expandedId);

  return (
    <AsyncState
      kind="conflict"
      state="attention"
      testId="ambiguity-notice"
      title={FR_COPY.status.conflict}
      description={
        <>
          <p>
            {records.length === 1
              ? "Une décision est nécessaire sur cette page."
              : `${records.length} décisions sont nécessaires sur cette page.`}
          </p>
          <ul className="ambiguity-list">
            {records.map((record) => (
              <li key={record.ambiguityId}>
                <button
                  type="button"
                  data-testid={`ambiguity-item-${record.ambiguityId}`}
                  aria-expanded={expandedId === record.ambiguityId}
                  onClick={() =>
                    setExpandedId((current) =>
                      current === record.ambiguityId ? null : record.ambiguityId,
                    )
                  }
                >
                  {KIND_LABELS[record.kind]}
                </button>
              </li>
            ))}
          </ul>
          {expanded === undefined ? null : (
            <PageAmbiguityResolution
              record={expanded}
              onResolve={(decision) => {
                onResolve?.(expanded.ambiguityId, decision);
                setExpandedId(null);
              }}
            />
          )}
        </>
      }
    />
  );
}

function describeSubtree(record: PageAmbiguityRecord): string {
  const subtree = record.details.recoverableSubtree ?? record.details.deletedSubtree;
  if (subtree === undefined) return "Contenu conservé.";
  const text =
    subtree.type === "code"
      ? subtree.text
      : "content" in subtree
        ? subtree.content.map((inline) => inline.text).join("")
        : "";
  const preview = text.trim().slice(0, 80);
  return preview === "" ? "Contenu sans texte." : `« ${preview}${text.length > 80 ? "…" : ""} »`;
}

export function PageAmbiguityResolution({
  record,
  onResolve,
}: {
  readonly record: PageAmbiguityRecord;
  readonly onResolve: (decision: "confirm-delete" | "restore-change") => void;
}) {
  const [busy, setBusy] = useState(false);

  const deletable = record.kind === "delete-edit" || record.kind === "delete-move";

  return (
    <div className="ambiguity-resolution" data-testid="ambiguity-resolution">
      <p>{describeSubtree(record)}</p>
      <div className="ambiguity-actions">
        <Button
          type="button"
          variant="secondary"
          size="compact"
          disabled={busy}
          data-testid="ambiguity-restore"
          onClick={() => {
            setBusy(true);
            onResolve("restore-change");
          }}
        >
          Conserver le contenu modifié
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="compact"
          disabled={busy || !deletable}
          title={deletable ? undefined : "Cette ambiguïté ne porte pas de suppression."}
          data-testid="ambiguity-confirm-delete"
          onClick={() => {
            setBusy(true);
            onResolve("confirm-delete");
          }}
        >
          Confirmer la suppression
        </Button>
      </div>
    </div>
  );
}
