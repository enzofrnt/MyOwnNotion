/**
 * Discreet per-page attachment panel (T060, US2).
 *
 * Attachments stay out of the main tree (FR-006) and are discoverable here:
 * import a new file, attach an existing canonical file, or remove one
 * placement (the final removal sends the file to the 30-day trash).
 */

import type { FileUsageDto, ItemDto, ProblemDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContentApi } from "../../services/content-api.ts";
import { safeKeyBetween } from "../../services/ordering.ts";
import { AttachmentList, type AttachmentRow } from "../files/attachment-list.tsx";
import { formatByteLength } from "../hierarchy/file-node.tsx";
import { ReplaceFileContent } from "./replace-file-content.tsx";

export function AttachmentPanel({
  pageId,
  onChanged,
  onOpenUsage,
}: {
  readonly pageId: Uuid;
  readonly onChanged?: () => void;
  /** Opens a page that uses one of these files, so a usage is reachable (FR-005). */
  readonly onOpenUsage?: (itemId: Uuid) => void;
}) {
  const api = useMemo(() => new ContentApi(), []);
  const [attachments, setAttachments] = useState<ItemDto[]>([]);
  const [usagesByFile, setUsagesByFile] = useState<Record<string, FileUsageDto[]>>({});
  const [problem, setProblem] = useState<ProblemDto | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    // Attachments are file items with an attachment placement on this page.
    const result = await api.listItems({ lifecycle: "active" });
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    const attached = result.value.items.filter((item) =>
      item.placements.some(
        (placement) => placement.kind === "attachment" && placement.parentItemId === pageId,
      ),
    );
    setAttachments(attached);

    // Usages are fetched per file rather than carried on the listing: they are
    // read on this one screen, and putting them on every item would cost every
    // screen for this screen's benefit.
    const collected: Record<string, FileUsageDto[]> = {};
    for (const item of attached) {
      const usages = await api.fileUsages(item.id as Uuid);
      // A usage lookup that fails leaves the row without usages rather than
      // failing the panel: the other eight fields are still worth showing, and
      // the deletion path fetches its own list before destroying anything.
      collected[item.id] = usages.ok ? usages.value.usages : [];
    }
    setUsagesByFile(collected);
  }, [api, pageId]);

  /**
   * The nine fields of FR-002, assembled from what the client actually knows.
   *
   * Availability is `present` for everything the API just returned, which is
   * honest today: nothing offloads yet. It becomes real in US4, and the row
   * already renders all three states so that arrival is a data change rather
   * than a redesign.
   */
  const rows: AttachmentRow[] = attachments.map((item) => {
    const placement = item.placements.find(
      (candidate) => candidate.kind === "attachment" && candidate.parentItemId === pageId,
    );
    return {
      item,
      addedAt: null,
      location: placement === undefined ? "this page" : "this page",
      usages: usagesByFile[item.id] ?? [],
      availability: "present",
      // The server answered with it, so it is stored and verified there.
      synchronized: true,
    };
  });

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
      const positionKey = safeKeyBetween(keys[keys.length - 1] ?? null, null);
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
      <AttachmentList
        rows={rows}
        onOpenUsage={(itemId) => onOpenUsage?.(itemId as Uuid)}
        actions={(row) => {
          const placement = row.item.placements.find(
            (candidate) => candidate.kind === "attachment" && candidate.parentItemId === pageId,
          );
          return (
            <>
              <button
                type="button"
                aria-label={`Remove ${row.item.name} from this page`}
                onClick={() =>
                  placement !== undefined ? void removePlacement(placement.id as Uuid) : undefined
                }
              >
                remove
              </button>
              <ReplaceFileContent
                itemId={row.item.id as Uuid}
                currentRevisionId={row.item.currentRevisionId as Uuid}
                onReplaced={() => {
                  void refresh();
                  onChanged?.();
                }}
              />
            </>
          );
        }}
      />
    </section>
  );
}

export { formatByteLength };
