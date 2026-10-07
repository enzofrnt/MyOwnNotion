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
 * owner learns to dismiss the warning that matters. A positive projection hint
 * opens the warning immediately; the canonical command still checks the latest
 * content before any write, including when that hint is missing or stale.
 *
 * The dialog is a real one: it takes focus, traps it, closes on Escape, and
 * returns focus to the control that opened it (FR-018).
 */

import type { Uuid } from "@myownnotion/domain";
import { type Ref, type RefObject, useCallback, useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import {
  AsyncState,
  Button,
  DialogContent,
  DialogDescription,
  DialogHeading,
  DialogRoot,
  MenuItem,
} from "../../ui/primitives/index.ts";

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
  holdsContent,
  convert,
  finalFocus,
  onActiveChange,
  variant = "button",
}: {
  readonly itemId: Uuid;
  readonly itemName: string;
  readonly kind: ConvertibleKind;
  readonly holdsContent?: boolean | undefined;
  readonly convert: (
    itemId: Uuid,
    targetKind: ConvertibleKind,
    confirmedDestruction: boolean,
  ) => Promise<ConvertOutcome>;
  readonly finalFocus?: RefObject<HTMLElement | null>;
  readonly onActiveChange?: (active: boolean) => void;
  readonly variant?: "button" | "menu" | "switch";
}) {
  const [pendingKind, setPendingKind] = useState<ConvertibleKind | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quietReturnFocus, setQuietReturnFocus] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const running = useRef(false);
  const openedWithPointer = useRef(false);

  const target: ConvertibleKind = kind === "page" ? "folder" : "page";
  const pending = pendingKind !== null;

  const close = useCallback(() => {
    if (running.current) return;
    setConfirming(false);
    setQuietReturnFocus(variant === "switch" && openedWithPointer.current);
    onActiveChange?.(false);
  }, [onActiveChange, variant]);

  const run = useCallback(
    async (confirmedDestruction: boolean) => {
      if (running.current) return;
      if (!confirmedDestruction && target === "folder" && holdsContent === true) {
        setError(null);
        onActiveChange?.(true);
        setConfirming(true);
        return;
      }
      running.current = true;
      onActiveChange?.(true);
      setPendingKind(target);
      setError(null);
      let outcome: ConvertOutcome;
      try {
        outcome = await convert(itemId, target, confirmedDestruction);
      } catch (cause) {
        outcome = {
          ok: false,
          needsConfirmation: false,
          message: cause instanceof Error ? cause.message : "La conversion n’a pas abouti.",
        };
      } finally {
        running.current = false;
        setPendingKind(null);
      }

      if (outcome.ok) {
        setConfirming(false);
        onActiveChange?.(false);
        return;
      }
      if (outcome.needsConfirmation) {
        // The projection hint was absent or stale. The canonical refusal still
        // protects newly added content without an optimistic destructive write.
        setConfirming(true);
        return;
      }
      setError(outcome.message ?? "La conversion n’a pas abouti.");
      onActiveChange?.(false);
    },
    [convert, itemId, target, holdsContent, onActiveChange],
  );

  return (
    <DialogRoot
      open={confirming}
      setOpen={(open) => {
        if (!open) close();
      }}
    >
      {variant === "switch" ? (
        <fieldset
          className="database-card-kind"
          aria-label="Type d’élément"
          aria-busy={pending || undefined}
          data-pending-kind={pendingKind ?? undefined}
          data-quiet-return-focus={quietReturnFocus || undefined}
          onKeyDownCapture={() => setQuietReturnFocus(false)}
          onBlurCapture={() => setQuietReturnFocus(false)}
        >
          {(["page", "folder"] as const).map((choice) => (
            <Button
              key={choice}
              size="compact"
              variant="ghost"
              ref={choice === target ? (trigger as Ref<HTMLButtonElement>) : undefined}
              aria-pressed={kind === choice}
              disabled={pending}
              title={
                choice === kind
                  ? undefined
                  : `Transformer en ${choice === "page" ? "page" : "dossier"}`
              }
              onClick={(event) => {
                if (choice !== kind) {
                  openedWithPointer.current = event.detail > 0;
                  setQuietReturnFocus(false);
                  void run(false);
                }
              }}
            >
              <AppIcon name={choice === "page" ? "file" : "folder"} size="small" />
              {choice === "page" ? "Page" : "Dossier"}
            </Button>
          ))}
        </fieldset>
      ) : variant === "menu" ? (
        <MenuItem
          ref={trigger as Ref<HTMLDivElement>}
          disabled={pending}
          data-testid={`convert-${itemName}`}
          onClick={(event) => {
            event.stopPropagation();
            void run(false);
          }}
        >
          <AppIcon name={kind === "page" ? "convertToFolder" : "convertToPage"} />
          Transformer en {kind === "page" ? "dossier" : "page"}
        </MenuItem>
      ) : (
        <button
          type="button"
          ref={trigger as Ref<HTMLButtonElement>}
          className="ui-button navigation-item-convert"
          data-size="square"
          data-variant="ghost"
          disabled={pending}
          data-testid={`convert-${itemName}`}
          aria-label={
            kind === "page"
              ? `Transformer ${itemName} en dossier`
              : `Transformer ${itemName} en page`
          }
          onClick={(event) => {
            event.stopPropagation();
            void run(false);
          }}
        >
          <AppIcon name={kind === "page" ? "convertToFolder" : "convertToPage"} />
          <span className="ui-visually-hidden">{kind === "page" ? "en dossier" : "en page"}</span>
        </button>
      )}

      {confirming ? (
        <DialogContent
          role="alertdialog"
          finalFocus={finalFocus ?? trigger}
          size="medium"
          hideOnEscape={!pending}
          hideOnInteractOutside={!pending}
          className="convert-dialog"
          data-testid="convert-confirmation"
        >
          <DialogHeading id={`convert-title-${itemId}`}>
            Transformer « {itemName} » en dossier ?
          </DialogHeading>
          <DialogDescription id={`convert-body-${itemId}`}>
            Un dossier ne contient pas de texte :{" "}
            <strong>tout le contenu de cette page sera supprimé</strong>, ainsi que les fichiers
            attachés à ce contenu.
          </DialogDescription>
          <p>
            Tout ce qui est classé <em>sous</em> cette page — sous-pages, sous-dossiers et fichiers
            — reste exactement à sa place.
          </p>
          <p className="muted" data-testid="convert-retention-notice">
            Cette conversion peut être annulée depuis l’historique tant que les anciennes révisions
            sont conservées. Après cette période, le texte sera définitivement supprimé.
          </p>
          <div className="convert-dialog__actions">
            <Button
              variant="danger"
              busy={pending}
              data-testid="confirm-convert"
              onClick={() => void run(true)}
            >
              Supprimer le contenu et convertir
            </Button>
            <Button disabled={pending} data-testid="cancel-convert" onClick={close}>
              Conserver cette page
            </Button>
          </div>
        </DialogContent>
      ) : null}

      {error !== null ? <AsyncState compact kind="error" description={error} /> : null}
    </DialogRoot>
  );
}
