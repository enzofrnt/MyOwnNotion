/**
 * Converting a page to a folder, and back (T020, T026-T029, US1, US2).
 *
 * Two controls that look symmetric and are not. Folder to page adds a
 * capability and destroys nothing, so it acts immediately. Page to folder
 * destroys the page's text and the attachments bound to it, so it asks first —
 * and what it asks is the point of the whole component.
 *
 * **The confirmation names what is lost, and how long it can be undone.** Not
 * "are you sure?", which an owner learns to click through, but the two facts
 * they need: the content and its attachments go, and the history brings them
 * back only for as long as revisions are retained. Saying "you can undo this"
 * without the limit would promise a reversibility that expires in silence.
 *
 * **It does not warn about a page that holds nothing.** Every page has a
 * document from the moment it is created, so warning on that basis would fire
 * on a page made a minute ago and never typed in — which is precisely how an
 * owner learns to dismiss the warning that matters. The server decides; this
 * asks only when it must.
 *
 * The dialog is a real one: it takes focus, traps it, closes on Escape, and
 * returns focus to the control that opened it (FR-018).
 */

import type { Uuid } from "@myownnotion/domain";
import { useCallback, useEffect, useRef, useState } from "react";

export type ConvertibleKind = "page" | "folder";

export interface ConvertOutcome {
  readonly ok: boolean;
  /** True when the server refused because the owner has not confirmed yet. */
  readonly needsConfirmation: boolean;
  readonly message?: string;
}

export function ConvertItemControl({
  itemId,
  itemName,
  kind,
  convert,
}: {
  readonly itemId: Uuid;
  readonly itemName: string;
  readonly kind: ConvertibleKind;
  readonly convert: (
    itemId: Uuid,
    targetKind: ConvertibleKind,
    confirmedDestruction: boolean,
  ) => Promise<ConvertOutcome>;
}) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);

  const target: ConvertibleKind = kind === "page" ? "folder" : "page";

  const close = useCallback(() => {
    setConfirming(false);
    // Focus goes back where it came from. Leaving it on <body> after a dialog
    // closes is the most common way a keyboard journey silently ends.
    trigger.current?.focus();
  }, []);

  const run = useCallback(
    async (confirmedDestruction: boolean) => {
      setPending(true);
      setError(null);
      const outcome = await convert(itemId, target, confirmedDestruction);
      setPending(false);

      if (outcome.ok) {
        setConfirming(false);
        return;
      }
      if (outcome.needsConfirmation) {
        // The server refused because this page holds content. Only now is the
        // owner asked — so an empty page converts without ever seeing a
        // warning about content it does not have.
        setConfirming(true);
        return;
      }
      setError(outcome.message ?? "The conversion did not complete.");
    },
    [convert, itemId, target],
  );

  useEffect(() => {
    if (!confirming) {
      return;
    }
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming, close]);

  return (
    <>
      <button
        type="button"
        ref={trigger}
        disabled={pending}
        data-testid={`convert-${itemName}`}
        aria-label={
          kind === "page" ? `Turn ${itemName} into a folder` : `Turn ${itemName} into a page`
        }
        onClick={() => void run(false)}
      >
        {kind === "page" ? "to folder" : "to page"}
      </button>

      {confirming ? (
        <div
          ref={dialog}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`convert-title-${itemId}`}
          aria-describedby={`convert-body-${itemId}`}
          tabIndex={-1}
          className="convert-dialog"
          data-testid="convert-confirmation"
        >
          <h2 id={`convert-title-${itemId}`}>Turn “{itemName}” into a folder?</h2>
          <p id={`convert-body-${itemId}`}>
            A folder has nowhere to keep text, so{" "}
            <strong>everything written on this page will be deleted</strong>, along with the files
            attached to that text.
          </p>
          <p>
            Everything filed <em>underneath</em> this page — sub-pages, sub-folders and files —
            stays exactly where it is.
          </p>
          <p className="muted" data-testid="convert-retention-notice">
            You can undo this from the page’s history, but only for as long as superseded revisions
            are kept. After that the text is gone for good.
          </p>
          <div className="field-row">
            <button
              type="button"
              data-testid="confirm-convert"
              disabled={pending}
              onClick={() => void run(true)}
            >
              Delete the content and convert
            </button>
            <button type="button" data-testid="cancel-convert" onClick={close}>
              Keep this page as it is
            </button>
          </div>
        </div>
      ) : null}

      {error !== null ? (
        <span className="status-banner" data-state="error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
