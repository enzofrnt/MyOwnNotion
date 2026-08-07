/**
 * Discreet per-page attachment panel (T060, US2).
 *
 * Attachments stay out of the main tree (FR-006) and are discoverable here:
 * import a new file, attach an existing canonical file, or remove one
 * placement (the final removal sends the file to the 30-day trash).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ItemDto, ProblemDto } from "@myownnotion/contracts";
import { generateUuidV7, keyBetween, type Uuid } from "@myownnotion/domain";
import { ContentApi } from "../../services/content-api.ts";
import { formatByteLength } from "../hierarchy/file-node.tsx";
import { ReplaceFileContent } from "./replace-file-content.tsx";

export function AttachmentPanel({
  pageId,
  onChanged,
}: {
  readonly pageId: Uuid;
  readonly onChanged?: () => void;
}) {
  const api = useMemo(() => new ContentApi(), []);
  const [attachments, setAttachments] = useState<ItemDto[]>([]);
  const [problem, setProblem] = useState<ProblemDto | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    // Attachments are file items with an attachment placement on this page.
    const result = await api.listItems({ lifecycle: "active" });
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setAttachments(
      result.value.items.filter((item) =>
        item.placements.some(
          (placement) => placement.kind === "attachment" && placement.parentItemId === pageId,
        ),
      ),
    );
  }, [api, pageId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importFile = useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0];
      if (file === undefined) {
        return;
      }
      setBusy(true);
      setProblem(null);
      const keys = attachments
        .flatMap((item) =>
          item.placements.filter(
            (placement) => placement.kind === "attachment" && placement.parentItemId === pageId,
          ),
        )
        .map((placement) => placement.positionKey)
        .sort();
      const positionKey = keyBetween(keys[keys.length - 1] ?? null, null);
      const result = await api.importFile(generateUuidV7(), file, {
        kind: "attachment",
        parentItemId: pageId,
        positionKey,
      });
      if (!result.ok) {
        setProblem(result.problem);
      }
      setBusy(false);
      await refresh();
      onChanged?.();
    },
    [api, attachments, pageId, refresh, onChanged],
  );

  const removePlacement = useCallback(
    async (placementId: Uuid) => {
      setProblem(null);
      const result = await api.removePlacement(generateUuidV7(), placementId);
      if (!result.ok) {
        setProblem(result.problem);
      }
      await refresh();
      onChanged?.();
    },
    [api, refresh, onChanged],
  );

  return (
    <section className="panel" aria-label="Page attachments" data-testid="attachment-panel">
      <h2>Attachments</h2>
      {problem !== null ? (
        <p className="status-banner" data-state="error" role="alert">
          {problem.code}: {problem.title}
        </p>
      ) : null}
      <div className="field-row">
        <label htmlFor={`attachment-upload-${pageId}`}>Import file into this page</label>
        <input
          id={`attachment-upload-${pageId}`}
          data-testid="attachment-upload"
          type="file"
          disabled={busy}
          onChange={(event) => void importFile(event.target.files)}
        />
      </div>
      {attachments.length === 0 ? (
        <p className="muted" data-testid="no-attachments">
          No attachments. Files attached here stay out of the hierarchy tree.
        </p>
      ) : (
        <ul className="tree">
          {attachments.map((item) => {
            const placement = item.placements.find(
              (candidate) =>
                candidate.kind === "attachment" && candidate.parentItemId === pageId,
            );
            return (
              <li key={item.id} className="tree-row" data-testid={`attachment-${item.name}`}>
                <span className="tree-kind">file</span>
                <span className="tree-name">{item.name}</span>
                <span className="muted">
                  {item.placements.length} placement{item.placements.length > 1 ? "s" : ""}
                </span>
                <span className="tree-actions">
                  <button
                    type="button"
                    aria-label={`Remove ${item.name} from this page`}
                    onClick={() =>
                      placement !== undefined
                        ? void removePlacement(placement.id as Uuid)
                        : undefined
                    }
                  >
                    remove
                  </button>
                </span>
                <ReplaceFileContent
                  itemId={item.id as Uuid}
                  currentRevisionId={item.currentRevisionId as Uuid}
                  onReplaced={() => {
                    void refresh();
                    onChanged?.();
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export { formatByteLength };
