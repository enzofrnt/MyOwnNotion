/**
 * What a page carries, stated in full (T014, T015, US1, FR-002).
 *
 * Nine fields, and the list exists because of the last three. Name, type and
 * size make a file recognisable; *usages*, *local availability* and *sync
 * state* are what make it safe to act on. An attachment list that omits usages
 * turns every deletion into a guess, and one that omits local availability
 * turns every offline plan into a hope.
 *
 * Availability is shown as one of three states rather than a checkbox, and none
 * of them reads as "missing": content the server holds is not lost because this
 * device has not fetched it, and saying otherwise is the most damaging sentence
 * this screen could contain.
 */

import type { FileUsageDto, ItemDto } from "@myownnotion/contracts";
import { AsyncState, Button, FR_COPY, formatDate } from "../../ui/index.ts";
import { formatByteLength } from "../hierarchy/file-node.tsx";

export type LocalAvailability = "present" | "offloaded" | "never-fetched";

/** What each availability state says, in the owner's terms. */
const AVAILABILITY: Record<LocalAvailability, { readonly label: string; readonly detail: string }> =
  {
    present: {
      label: FR_COPY.files.attachments.onDevice,
      detail: FR_COPY.files.attachments.onDeviceDetail,
    },
    offloaded: {
      label: FR_COPY.files.attachments.offloaded,
      // Names the cause, because the owner did not do this and would otherwise
      // wonder what went wrong.
      detail: FR_COPY.files.attachments.offloadedDetail,
    },
    "never-fetched": {
      label: FR_COPY.files.attachments.neverFetched,
      detail: FR_COPY.files.attachments.neverFetchedDetail,
    },
  };

export interface AttachmentRow {
  readonly item: ItemDto;
  readonly addedAt: string | null;
  readonly location: string;
  readonly usages: readonly FileUsageDto[];
  readonly availability: LocalAvailability;
  readonly synchronized: boolean;
}

export function AttachmentList({
  rows,
  onOpenUsage,
  actions,
}: {
  readonly rows: readonly AttachmentRow[];
  readonly onOpenUsage: (itemId: string) => void;
  /** Rendered per row, so this component states facts and owns no verbs. */
  readonly actions?: (row: AttachmentRow) => React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <AsyncState
        compact
        kind="empty"
        description={FR_COPY.files.attachments.empty}
        testId="attachments-empty"
      />
    );
  }

  return (
    <ul className="tree" data-testid="attachment-list">
      {rows.map((row) => {
        const availability = AVAILABILITY[row.availability];
        return (
          <li
            key={row.item.id}
            className="tree-row"
            data-testid={`attachment-${row.item.name}`}
            data-availability={row.availability}
          >
            <span className="tree-kind">{FR_COPY.files.attachments.fileKind}</span>
            <span className="tree-name">{row.item.name}</span>

            <span className="muted" data-testid={`attachment-type-${row.item.name}`}>
              {mediaTypeOf(row.item)}
            </span>
            <span className="muted" data-testid={`attachment-size-${row.item.name}`}>
              {formatByteLength(byteLengthOf(row.item))}
            </span>
            <span className="muted" data-testid={`attachment-added-${row.item.name}`}>
              {row.addedAt === null
                ? FR_COPY.files.attachments.addedUnknown
                : `${FR_COPY.files.attachments.added} ${formatDate(row.addedAt)}`}
            </span>
            <span className="muted" data-testid={`attachment-location-${row.item.name}`}>
              {FR_COPY.files.attachments.inLocation} {row.location}
            </span>

            <span
              className="muted"
              data-testid={`attachment-availability-${row.item.name}`}
              title={availability.detail}
            >
              {availability.label}
            </span>
            <span className="muted" data-testid={`attachment-sync-${row.item.name}`}>
              {row.synchronized
                ? FR_COPY.files.attachments.synchronized
                : FR_COPY.files.attachments.notSynchronized}
            </span>

            <span className="muted" data-testid={`attachment-usages-${row.item.name}`}>
              {row.usages.length === 0 ? (
                FR_COPY.files.attachments.usedNowhereElse
              ) : (
                <>
                  {FR_COPY.files.attachments.usedIn}{" "}
                  {row.usages.map((usage, index) => (
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
                </>
              )}
            </span>

            {actions !== undefined ? <span className="tree-actions">{actions(row)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function mediaTypeOf(item: ItemDto): string {
  const file = (item as { file?: { mediaType?: string } }).file;
  return file?.mediaType ?? FR_COPY.files.attachments.unknownType;
}

function byteLengthOf(item: ItemDto): number {
  const file = (item as { file?: { byteLength?: number } }).file;
  return file?.byteLength ?? 0;
}

/**
 * A date the owner can read, in their own locale.
 *
 * Falls back to the raw value rather than throwing: a malformed timestamp is a
 * reason to show something imperfect, never a reason for the attachment list to
 * fail to render.
 */
