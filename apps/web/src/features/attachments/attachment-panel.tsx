/**
 * Discreet per-page attachment panel (T060, US2).
 *
 * Attachments stay out of the main tree (FR-006) and are discoverable here:
 * import a new file, attach an existing canonical file, or remove one
 * placement (the final removal sends the file to the 30-day trash).
 */

import type { FileUsageDto, ItemDto, ProblemDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContentApi } from "../../services/content-api.ts";
import { safeKeyBetween } from "../../services/ordering.ts";
import { AppIcon } from "../../ui/icons.tsx";
import {
  AsyncState,
  Button,
  FR_COPY,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../../ui/index.ts";
import { AttachmentList, type AttachmentRow } from "../files/attachment-list.tsx";
import { DeleteFile } from "../files/delete-file.tsx";
import { FilePreview } from "../files/file-preview.tsx";
import { formatByteLength } from "../hierarchy/file-node.tsx";
import { ReplaceFileContent } from "./replace-file-content.tsx";

export type { AttachmentRow };

function attachmentMediaType(row: AttachmentRow): string {
  return (
    (row.item as { file?: { mediaType?: string } }).file?.mediaType ??
    FR_COPY.files.attachments.unknownType
  );
}

function attachmentByteLength(row: AttachmentRow): number {
  return (row.item as { file?: { byteLength?: number } }).file?.byteLength ?? 0;
}

/** The tree shows only recognition data; detailed facts and verbs stay one click away. */
export function CompactAttachmentList({
  actions,
  onOpenUsage,
  rows,
}: {
  readonly rows: readonly AttachmentRow[];
  readonly onOpenUsage: (itemId: string) => void;
  readonly actions: (row: AttachmentRow) => ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <p className="workspace-attachment-empty" data-testid="attachments-empty">
        Aucune pièce jointe
      </p>
    );
  }

  return (
    <ul className="workspace-attachment-list" data-testid="attachment-list">
      {rows.map((row) => (
        <li
          key={row.item.id}
          className="workspace-attachment-file"
          data-testid={`attachment-${row.item.name}`}
          data-availability={row.availability}
        >
          <AppIcon name="file" size="small" />
          <span className="workspace-attachment-file__name">{row.item.name}</span>
          <span
            className="workspace-attachment-file__size"
            data-testid={`attachment-size-${row.item.name}`}
          >
            {formatByteLength(attachmentByteLength(row))}
          </span>
          <span className="workspace-attachment-file__details">
            <PopoverRoot placement="right-start">
              <PopoverTrigger
                className="workspace-attachment-file__details-trigger"
                aria-label={`Actions pour ${row.item.name}`}
                data-testid={`attachment-actions-${row.item.name}`}
              >
                <AppIcon name="more" size="small" />
              </PopoverTrigger>
              <PopoverContent
                className="workspace-attachment-file__details-panel"
                aria-label={`Détails de ${row.item.name}`}
                data-testid={`attachment-details-${row.item.name}`}
                portal={false}
              >
                <span data-testid={`attachment-type-${row.item.name}`}>
                  {attachmentMediaType(row)}
                </span>
                <span data-testid={`attachment-added-${row.item.name}`}>
                  {row.addedAt ?? FR_COPY.files.attachments.addedUnknown}
                </span>
                <span data-testid={`attachment-location-${row.item.name}`}>
                  {FR_COPY.files.attachments.inLocation} {row.location}
                </span>
                <span data-testid={`attachment-availability-${row.item.name}`}>
                  {row.availability === "present"
                    ? FR_COPY.files.attachments.onDevice
                    : row.availability === "offloaded"
                      ? FR_COPY.files.attachments.offloaded
                      : FR_COPY.files.attachments.neverFetched}
                </span>
                <span data-testid={`attachment-sync-${row.item.name}`}>
                  {row.synchronized
                    ? FR_COPY.files.attachments.synchronized
                    : FR_COPY.files.attachments.notSynchronized}
                </span>
                <span data-testid={`attachment-usages-${row.item.name}`}>
                  {row.usages.length === 0
                    ? FR_COPY.files.attachments.usedNowhereElse
                    : row.usages.map((usage, index) => (
                        <span key={`${usage.usedByItemId}-${usage.blockId ?? index}`}>
                          {index > 0 ? ", " : null}
                          <Button
                            type="button"
                            size="compact"
                            variant="ghost"
                            data-testid={`attachment-usage-${usage.usedByName}`}
                            onClick={() => onOpenUsage(usage.usedByItemId)}
                          >
                            {usage.usedByName}
                          </Button>
                        </span>
                      ))}
                </span>
                <span className="workspace-attachment-file__actions">{actions(row)}</span>
              </PopoverContent>
            </PopoverRoot>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AttachmentPanel({
  compact = false,
  pageId,
  onChanged,
  onOpenUsage,
}: {
  readonly pageId: Uuid;
  readonly compact?: boolean;
  readonly onChanged?: () => void;
  /** Opens a page that uses one of these files, so a usage is reachable (FR-005). */
  readonly onOpenUsage?: (itemId: Uuid) => void;
}) {
  const api = useMemo(() => new ContentApi(), []);
  const [attachments, setAttachments] = useState<ItemDto[]>([]);
  const [usagesByFile, setUsagesByFile] = useState<Record<string, FileUsageDto[]>>({});
  const [problem, setProblem] = useState<ProblemDto | null>(null);
  const [busy, setBusy] = useState(false);
  /** One preview open at a time: several 2 GB blobs at once is a crash. */
  const [previewing, setPreviewing] = useState<string | null>(null);
  const compactUploadInput = useRef<HTMLInputElement | null>(null);

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
    return {
      item,
      addedAt: null,
      location: FR_COPY.files.attachments.location,
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

  const actions = (row: AttachmentRow): ReactNode => {
    const placement = row.item.placements.find(
      (candidate) => candidate.kind === "attachment" && candidate.parentItemId === pageId,
    );
    return (
      <>
        <Button
          type="button"
          size="compact"
          variant="ghost"
          aria-label={`${FR_COPY.files.attachments.remove} : ${row.item.name}`}
          onClick={() =>
            placement !== undefined ? void removePlacement(placement.id as Uuid) : undefined
          }
        >
          {FR_COPY.files.attachments.removeAction}
        </Button>
        <Button
          type="button"
          size="compact"
          variant="ghost"
          aria-label={`${FR_COPY.files.attachments.preview} : ${row.item.name}`}
          data-testid={`preview-file-${row.item.name}`}
          onClick={() => setPreviewing((current) => (current === row.item.id ? null : row.item.id))}
        >
          {previewing === row.item.id
            ? FR_COPY.files.attachments.closePreview
            : FR_COPY.files.attachments.previewAction}
        </Button>
        <DeleteFile
          api={api}
          fileItemId={row.item.id as Uuid}
          fileName={row.item.name}
          onDeleted={() => {
            void refresh();
            onChanged?.();
          }}
        />
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
  };

  return (
    <section
      className="workspace-attachment-panel"
      aria-label={FR_COPY.files.attachments.label}
      data-testid="attachment-panel"
    >
      <div className="workspace-attachment-panel__header">
        <h2>{FR_COPY.files.attachments.title}</h2>
        {compact ? (
          <span className="workspace-attachment-panel__count" title={`${rows.length} fichiers`}>
            {rows.length}
          </span>
        ) : null}
        {compact ? (
          <Button
            type="button"
            size="square"
            variant="ghost"
            className="workspace-attachment-panel__upload"
            aria-label={FR_COPY.files.attachments.add}
            title={FR_COPY.files.attachments.add}
            disabled={busy}
            onClick={() => compactUploadInput.current?.click()}
          >
            <AppIcon name="add" size="small" />
          </Button>
        ) : null}
        {compact ? (
          <input
            ref={compactUploadInput}
            data-testid="attachment-upload"
            type="file"
            hidden
            disabled={busy}
            onChange={(event) => void importFile(event.target.files)}
          />
        ) : null}
      </div>
      {problem !== null ? (
        <AsyncState kind="error" compact description={FR_COPY.files.attachments.loadFailed} />
      ) : null}
      {compact ? null : (
        <div className="field-row">
          <label htmlFor={`attachment-upload-${pageId}`}>{FR_COPY.files.attachments.add}</label>
          <input
            id={`attachment-upload-${pageId}`}
            data-testid="attachment-upload"
            type="file"
            disabled={busy}
            onChange={(event) => void importFile(event.target.files)}
          />
        </div>
      )}
      {compact ? (
        <CompactAttachmentList
          rows={rows}
          onOpenUsage={(itemId) => onOpenUsage?.(itemId as Uuid)}
          actions={actions}
        />
      ) : (
        <AttachmentList
          rows={rows}
          onOpenUsage={(itemId) => onOpenUsage?.(itemId as Uuid)}
          actions={actions}
        />
      )}

      {previewing !== null
        ? (() => {
            const row = rows.find((candidate) => candidate.item.id === previewing);
            if (row === undefined) {
              return null;
            }
            const file = (row.item as { file?: { mediaType?: string; byteLength?: number } }).file;
            return (
              <FilePreview
                fileItemId={row.item.id}
                fileName={row.item.name}
                mediaType={file?.mediaType ?? "application/octet-stream"}
                byteLength={file?.byteLength ?? 0}
                availability={row.availability}
                onFetched={() => void refresh()}
              />
            );
          })()
        : null}
    </section>
  );
}

export { formatByteLength };
