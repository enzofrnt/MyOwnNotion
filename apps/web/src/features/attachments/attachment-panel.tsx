import { AttachmentUsages } from "../files/attachment-usages.tsx";
/**
 * Discreet per-page attachment panel (T060, US2).
 *
 * Attachments stay out of the main tree (FR-006) and are discoverable here:
 * inspect the files embedded in the current local document. Insertion and
 * removal of page references belong to the editor, not to this list.
 */

import type { ProjectedItem } from "@myownnotion/client-core";
import type { FileUsageDto, ProblemDto } from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContentApi } from "../../services/content-api.ts";
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

function attachmentPopoverContainer(): HTMLElement {
  return document.querySelector<HTMLElement>(".workspace-sidebar-drawer") ?? document.body;
}

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
          <AppIcon name="paperclip" size="small" />
          <span className="workspace-attachment-file__name" title={row.item.name}>
            {row.item.name}
          </span>
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
                unmountOnHide
                className="workspace-attachment-file__details-panel"
                aria-label={`Détails de ${row.item.name}`}
                data-testid={`attachment-details-${row.item.name}`}
                portalElement={attachmentPopoverContainer}
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
                  {row.usagesKnown === false ? (
                    FR_COPY.files.attachments.usagesUnknown
                  ) : row.usages.length === 0 ? (
                    FR_COPY.files.attachments.usedNowhereElse
                  ) : (
                    <AttachmentUsages usages={row.usages} onOpenUsage={onOpenUsage} />
                  )}
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
  attachments,
  compact = false,
  pageId,
  onChanged,
  onOpenUsage,
}: {
  readonly pageId: Uuid;
  readonly attachments: readonly ProjectedItem[] | undefined;
  readonly compact?: boolean;
  readonly onChanged?: () => void;
  /** Opens a page that uses one of these files, so a usage is reachable (FR-005). */
  readonly onOpenUsage?: (itemId: Uuid) => void;
}) {
  const api = useMemo(() => new ContentApi(), []);
  const [usagesByFile, setUsagesByFile] = useState<Record<string, FileUsageDto[]>>({});
  const [problem, setProblem] = useState<ProblemDto | null>(null);
  const usagesRequest = useRef(0);
  /** One preview open at a time: several 2 GB blobs at once is a crash. */
  const [previewing, setPreviewing] = useState<string | null>(null);
  const attachmentIds = attachments?.map((item) => item.id).join(",") ?? "";

  const refresh = useCallback(async () => {
    const request = ++usagesRequest.current;
    setProblem(null);
    // Usages are fetched per file rather than carried on the listing: they are
    // read on this one screen, and putting them on every item would cost every
    // screen for this screen's benefit.
    const collected: Record<string, FileUsageDto[]> = {};
    for (const id of attachmentIds.split(",").filter(Boolean)) {
      const usages = await api.fileUsages(id as Uuid);
      if (request !== usagesRequest.current) return;
      // A usage lookup that fails leaves the row without usages rather than
      // failing the panel: the other eight fields are still worth showing, and
      // the deletion path fetches its own list before destroying anything.
      if (!usages.ok) setProblem(usages.problem);
      else collected[id] = usages.value.usages;
    }
    setUsagesByFile(collected);
  }, [api, attachmentIds]);

  /**
   * The nine fields of FR-002, assembled from what the client actually knows.
   *
   * Membership and local availability come from the durable local projection.
   * A successful usages lookup confirms that the server knows the file.
   */
  const rows: AttachmentRow[] = (attachments ?? []).map((item) => {
    return {
      item,
      addedAt: null,
      location: FR_COPY.files.attachments.location,
      usages: usagesByFile[item.id] ?? [],
      usagesKnown: usagesByFile[item.id] !== undefined,
      availability: item.localAvailability,
      synchronized: usagesByFile[item.id] !== undefined,
    };
  });

  useEffect(() => {
    void refresh();
    return () => {
      ++usagesRequest.current;
    };
  }, [refresh]);

  const actions = (row: AttachmentRow): ReactNode => {
    return (
      <>
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
        {compact && attachments !== undefined ? (
          <span className="workspace-attachment-panel__count" title={`${rows.length} fichiers`}>
            {rows.length}
          </span>
        ) : null}
      </div>
      {problem !== null ? (
        <AsyncState
          kind="error"
          compact
          description={FR_COPY.files.attachments.usagesUnavailable}
          action={
            <Button type="button" size="compact" variant="ghost" onClick={() => void refresh()}>
              {FR_COPY.actions.retry}
            </Button>
          }
        />
      ) : null}
      {attachments === undefined ? (
        <AsyncState
          kind="info"
          compact
          title={FR_COPY.files.attachments.unloadedTitle}
          description={FR_COPY.files.attachments.unloadedDescription}
          action={
            onOpenUsage === undefined ? undefined : (
              <Button
                type="button"
                size="compact"
                variant="ghost"
                onClick={() => onOpenUsage(pageId)}
              >
                {FR_COPY.files.attachments.openPage}
              </Button>
            )
          }
        />
      ) : compact ? (
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
