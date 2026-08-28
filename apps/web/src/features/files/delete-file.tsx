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
import { type NamedUsage, planFileDeletion, type Uuid } from "@myownnotion/domain";
import { useCallback, useRef, useState } from "react";
import type { ContentApi } from "../../services/content-api.ts";
import { AsyncState, Button, ConfirmDialog, FR_COPY, formatNumber } from "../../ui/index.ts";

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
  const trigger = useRef<HTMLButtonElement | null>(null);

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
      setStage({ kind: "failed", message: FR_COPY.files.deletion.deleteFailed });
      return;
    }
    for (const placement of item.value.placements) {
      const removed = await api.removePlacement(crypto.randomUUID() as Uuid, placement.id as Uuid);
      if (!removed.ok) {
        setStage({
          kind: "failed",
          message: FR_COPY.files.deletion.deleteFailed,
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
        message: FR_COPY.files.deletion.checkFailed,
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
      <Button
        type="button"
        ref={trigger}
        size="compact"
        variant="danger"
        aria-label={`${FR_COPY.files.deletion.action} : ${fileName}`}
        data-testid={`delete-file-${fileName}`}
        busy={stage.kind === "checking"}
        onClick={() => void ask()}
      >
        {FR_COPY.actions.delete}
      </Button>

      {stage.kind === "failed" ? (
        <AsyncState compact kind="error" description={stage.message} />
      ) : null}

      <ConfirmDialog
        open={stage.kind === "confirming"}
        title={
          <>
            {FR_COPY.files.deletion.title} <span className="ui-muted-inline">{fileName}</span>
          </>
        }
        description={FR_COPY.files.deletion.description}
        confirmLabel={FR_COPY.files.deletion.confirm}
        confirmTestId="delete-file-confirm"
        cancelLabel={FR_COPY.files.deletion.keep}
        cancelTestId="delete-file-cancel"
        onCancel={dismiss}
        onConfirm={() => void destroy()}
        testId="delete-file-confirmation"
      >
        {stage.kind === "confirming" ? (
          <>
            <p data-testid="delete-file-usages">
              {formatNumber(stage.usages.length)}{" "}
              {stage.usages.length === 1
                ? FR_COPY.files.deletion.usageSingular
                : FR_COPY.files.deletion.usagePlural}
            </p>
            <ul className="tree" data-testid="delete-file-usage-list">
              {stage.usages.map((usage, index) => (
                <li key={`${usage.usedByItemId}-${usage.blockId ?? index}`} className="tree-row">
                  <span className="tree-kind">{usage.usageKind}</span>
                  <span className="tree-name">{usage.usedByName}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </ConfirmDialog>
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
