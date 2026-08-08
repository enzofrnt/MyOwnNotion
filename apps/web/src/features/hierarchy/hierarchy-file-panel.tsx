/**
 * Hierarchy file inspector (FR-001 / T064).
 *
 * Selecting a hierarchy file entry exposes the same labelled metadata,
 * download, and placement controls that page attachments use.
 */

import type { ProjectedItem } from "@myownnotion/client-core";
import type { ProblemDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { useCallback, useMemo, useState } from "react";
import { ContentApi } from "../../services/content-api.ts";
import { FilePreview } from "../attachments/file-preview.tsx";
import { formatByteLength } from "./file-node.tsx";

function placementLabel(placement: ProjectedItem["placements"][number]): string {
  if (placement.kind === "hierarchy") {
    return placement.parentItemId === null
      ? "Workspace root"
      : `Under ${placement.parentItemId.slice(0, 8)}…`;
  }
  return placement.parentItemId === null
    ? "Page attachment"
    : `Attached to ${placement.parentItemId.slice(0, 8)}…`;
}

export function HierarchyFilePanel({
  item,
  onChanged,
}: {
  readonly item: ProjectedItem;
  readonly onChanged?: () => void | Promise<void>;
}) {
  const api = useMemo(() => new ContentApi(), []);
  const [problem, setProblem] = useState<ProblemDto | null>(null);
  const [busy, setBusy] = useState(false);

  const removePlacement = useCallback(
    async (placementId: Uuid) => {
      setBusy(true);
      setProblem(null);
      const result = await api.removePlacement(generateUuidV7(), placementId);
      if (!result.ok) setProblem(result.problem);
      setBusy(false);
      await onChanged?.();
    },
    [api, onChanged],
  );

  return (
    <section className="panel" aria-label="Hierarchy file" data-testid="hierarchy-file-panel">
      <h2>{item.name}</h2>
      {problem !== null ? (
        <p className="status-banner" data-state="error" role="alert">
          {problem.code}: {problem.title}
        </p>
      ) : null}
      {item.file !== null ? (
        <p className="muted" data-testid={`hierarchy-file-summary-${item.name}`}>
          {item.file.mediaType} · {formatByteLength(item.file.byteLength)} · SHA-256{" "}
          {item.file.sha256.slice(0, 10)}…
        </p>
      ) : null}
      <FilePreview
        itemId={item.id}
        revisionId={item.currentRevisionId}
        name={item.name}
        api={api}
      />
      <h3>Placements</h3>
      {item.placements.length === 0 ? (
        <p className="muted">No placements remain for this file.</p>
      ) : (
        <ul className="tree" aria-label={`Placements for ${item.name}`}>
          {item.placements.map((placement) => (
            <li
              key={placement.id}
              className="tree-row"
              data-testid={`file-placement-${placement.id}`}
            >
              <span className="tree-kind">{placement.kind}</span>
              <span className="tree-name">{placementLabel(placement)}</span>
              <span className="tree-actions">
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${placement.kind} placement of ${item.name}`}
                  onClick={() => void removePlacement(placement.id)}
                >
                  remove placement
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
