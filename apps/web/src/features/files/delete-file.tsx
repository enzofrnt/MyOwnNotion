/**
 * Deleting a file, with its usages in front of the owner (T021, US2, FR-004).
 *
 * The confirmation names every page that would lose the file, because the
 * question an owner is really answering is not "delete this?" but "am I willing
 * to break these?" — and they cannot answer that from a count.
 *
 * The usages are fetched at the moment the owner asks to delete, not carried
 * from whatever the list happened to show earlier. A confirmation built from a
 * stale list is one that omits the page added a minute ago, which is precisely
 * the page the owner has forgotten about.
 */

import type { FileUsageDto } from "@myownnotion/contracts";
import { describeUsages, type NamedUsage, planFileDeletion, type Uuid } from "@myownnotion/domain";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ContentApi } from "../../services/content-api.ts";

type Stage =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "confirming"; readonly usages: readonly NamedUsage[] }
  | { readonly kind: "failed"; readonly message: string };

export function DeleteFile({
  api,
  fileItemId,
  fileName,
  onDeleted,
}: {
  readonly api: ContentApi;
  readonly fileItemId: Uuid;
  readonly fileName: string;
  readonly onDeleted: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const dialog = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (stage.kind === "confirming") {
      // Focus moves into the dialogue, so a keyboard owner is where the
      // decision is rather than somewhere behind it.
      dialog.current?.focus();
    }
  }, [stage.kind]);

  /**
   * Removes every placement, which is how a file is deleted here.
   *
   * Not `item.trash`: feature 001 models a file's lifecycle through its
   * placements, and the last removal is what sends it to the 30-day trash.
   * Trashing the item directly bypasses that and the server refuses it. Going
   * through the modelled path also means this deletion is recoverable by the
   * same mechanism as everything else, which is what T022 asks for.
   */
  const destroy = useCallback(async () => {
    const item = await api.getItem(fileItemId);
    if (!item.ok) {
      setStage({ kind: "failed", message: `${item.problem.code}: ${item.problem.title}` });
      return;
    }
    for (const placement of item.value.placements) {
      const removed = await api.removePlacement(crypto.randomUUID() as Uuid, placement.id as Uuid);
      if (!removed.ok) {
        setStage({
          kind: "failed",
          message: `${removed.problem.code}: ${removed.problem.title}`,
        });
        return;
      }
    }
    setStage({ kind: "idle" });
    trigger.current?.focus();
    onDeleted();
  }, [api, fileItemId, onDeleted]);

  const ask = useCallback(async () => {
    setStage({ kind: "checking" });
    const result = await api.fileUsages(fileItemId);
    if (!result.ok) {
      // Not treated as "no usages". Failing to learn what uses a file is not
      // the same as learning that nothing does, and only one of those is safe
      // to act on.
      setStage({
        kind: "failed",
        message: "What uses this file could not be checked, so it has not been deleted.",
      });
      return;
    }
    const usages = result.value.usages.map(toNamedUsage);
    const plan = planFileDeletion({ fileExists: true, usages, confirmed: false });
    if (plan.kind === "proceed") {
      await destroy();
      return;
    }
    setStage({ kind: "confirming", usages });
  }, [api, fileItemId, destroy]);

  const dismiss = useCallback(() => {
    setStage({ kind: "idle" });
    trigger.current?.focus();
  }, []);

  return (
    <>
      <button
        type="button"
        ref={trigger}
        aria-label={`Delete ${fileName}`}
        data-testid={`delete-file-${fileName}`}
        disabled={stage.kind === "checking"}
        onClick={() => void ask()}
      >
        delete
      </button>

      {stage.kind === "failed" ? (
        <span className="status-banner" data-state="error" role="alert">
          {stage.message}
        </span>
      ) : null}

      {stage.kind === "confirming" ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          tabIndex={-1}
          ref={dialog}
          className="convert-dialog"
          data-testid="delete-file-confirmation"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              dismiss();
            }
          }}
        >
          <h3 id={titleId}>Delete {fileName}?</h3>
          <p id={bodyId} data-testid="delete-file-usages">
            {describeUsages(stage.usages)}
          </p>
          <ul className="tree" data-testid="delete-file-usage-list">
            {stage.usages.map((usage, index) => (
              <li key={`${usage.usedByItemId}-${usage.blockId ?? index}`} className="tree-row">
                <span className="tree-kind">{usage.usageKind}</span>
                <span className="tree-name">{usage.usedByName}</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            It goes to the trash and can be restored for 30 days, like anything else.
          </p>
          <div className="field-row">
            <button type="button" data-testid="delete-file-cancel" onClick={dismiss}>
              Keep the file
            </button>
            <button type="button" data-testid="delete-file-confirm" onClick={() => void destroy()}>
              Delete it anyway
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function toNamedUsage(usage: FileUsageDto): NamedUsage {
  return {
    usedByItemId: usage.usedByItemId as Uuid,
    usedByName: usage.usedByName,
    usageKind: usage.usageKind,
    blockId: (usage.blockId as Uuid | undefined) ?? null,
  };
}
