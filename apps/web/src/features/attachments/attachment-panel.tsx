/**
 * Discreet per-page attachment panel (T060, US2).
 *
 * Attachments stay out of the main tree (FR-006) and are discoverable here:
 * import a new file, attach an existing canonical file, or remove one
 * placement (the final removal sends the file to the 30-day trash).
 */

import type { ProblemDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContentApi } from "../../services/content-api.ts";
import { safeKeyBetween } from "../../services/ordering.ts";
import { formatByteLength } from "../hierarchy/file-node.tsx";
import { FilePreview } from "./file-preview.tsx";
import { ReplaceFileContent } from "./replace-file-content.tsx";

export interface AttachmentListItem {
  readonly id: string;
  readonly kind: "page" | "folder" | "file";
  readonly name: string;
  readonly lifecycle: "active" | "trashed" | "purged";
  readonly currentRevisionId: string;
  readonly placements: ReadonlyArray<{
    readonly id: string;
    readonly kind: "hierarchy" | "attachment";
    readonly parentItemId: string | null;
    readonly positionKey: string;
  }>;
}

export function selectReusableFiles(
  items: readonly AttachmentListItem[],
  pageId: Uuid,
  query: string,
): AttachmentListItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  return items
    .filter(
      (item) =>
        item.kind === "file" &&
        item.lifecycle === "active" &&
        !item.placements.some(
          (placement) => placement.kind === "attachment" && placement.parentItemId === pageId,
        ) &&
        (normalized.length === 0 || item.name.toLocaleLowerCase().includes(normalized)),
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 20);
}

export function AttachmentPanel({
  pageId,
  workspaceItems = [],
  onChanged,
}: {
  readonly pageId: Uuid;
  readonly workspaceItems?: readonly AttachmentListItem[];
  readonly onChanged?: () => void | Promise<void>;
}) {
  const api = useMemo(() => new ContentApi(), []);
  const [attachments, setAttachments] = useState<AttachmentListItem[]>([]);
  const [allItems, setAllItems] = useState<AttachmentListItem[]>([]);
  const [search, setSearch] = useState("");
  const [problem, setProblem] = useState<ProblemDto | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    // Attachments are file items with an attachment placement on this page.
    const result = await api.listItems({ lifecycle: "active" });
    if (!result.ok) {
      if (workspaceItems.length === 0) setProblem(result.problem);
      return;
    }
    setAllItems(result.value.items);
    setAttachments(
      result.value.items.filter((item) =>
        item.placements.some(
          (placement) => placement.kind === "attachment" && placement.parentItemId === pageId,
        ),
      ),
    );
  }, [api, pageId, workspaceItems.length]);

  const reusableFiles = useMemo(
    () => selectReusableFiles(allItems, pageId, search),
    [allItems, pageId, search],
  );

  useEffect(() => {
    setAllItems([...workspaceItems]);
    setAttachments(
      workspaceItems.filter((item) =>
        item.placements.some(
          (placement) => placement.kind === "attachment" && placement.parentItemId === pageId,
        ),
      ),
    );
    void refresh();
  }, [pageId, refresh, workspaceItems]);

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
      await onChanged?.();
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
      await onChanged?.();
    },
    [api, refresh, onChanged],
  );

  const attachExisting = useCallback(
    async (item: AttachmentListItem) => {
      setBusy(true);
      setProblem(null);
      const keys = attachments
        .flatMap((attachment) =>
          attachment.placements.filter(
            (placement) => placement.kind === "attachment" && placement.parentItemId === pageId,
          ),
        )
        .map((placement) => placement.positionKey)
        .sort();
      const result = await api.addFilePlacement(generateUuidV7(), item.id as Uuid, {
        kind: "attachment",
        parentItemId: pageId,
        positionKey: safeKeyBetween(keys[keys.length - 1] ?? null, null),
      });
      if (!result.ok) setProblem(result.problem);
      setBusy(false);
      setSearch("");
      await refresh();
      await onChanged?.();
    },
    [api, attachments, onChanged, pageId, refresh],
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
      <div className="existing-file-picker">
        <label htmlFor={`existing-file-search-${pageId}`}>Attach an existing file</label>
        <input
          id={`existing-file-search-${pageId}`}
          type="search"
          value={search}
          placeholder="Search workspace files"
          onChange={(event) => setSearch(event.target.value)}
          disabled={busy}
        />
        {search.trim().length > 0 ? (
          reusableFiles.length > 0 ? (
            <ul className="existing-file-results" aria-label="Reusable files">
              {reusableFiles.map((item) => (
                <li key={item.id}>
                  <button type="button" disabled={busy} onClick={() => void attachExisting(item)}>
                    Attach {item.name}
                  </button>
                  <span className="muted">
                    {item.placements.length} placement{item.placements.length === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No reusable file matches this search.</p>
          )
        ) : null}
      </div>
      {attachments.length === 0 ? (
        <p className="muted" data-testid="no-attachments">
          No attachments. Files attached here stay out of the hierarchy tree.
        </p>
      ) : (
        <ul className="tree">
          {attachments.map((item) => {
            const placement = item.placements.find(
              (candidate) => candidate.kind === "attachment" && candidate.parentItemId === pageId,
            );
            return (
              <li
                key={item.id}
                className="tree-row attachment-row"
                data-testid={`attachment-${item.name}`}
              >
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
                <FilePreview
                  itemId={item.id as Uuid}
                  revisionId={item.currentRevisionId as Uuid}
                  name={item.name}
                  api={api}
                />
                <ReplaceFileContent
                  itemId={item.id as Uuid}
                  currentRevisionId={item.currentRevisionId as Uuid}
                  onReplaced={() => {
                    void (async () => {
                      await refresh();
                      await onChanged?.();
                    })();
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
