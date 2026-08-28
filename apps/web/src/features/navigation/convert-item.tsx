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
  convert,
  finalFocus,
  variant = "button",
}: {
  readonly itemId: Uuid;
  readonly itemName: string;
  readonly kind: ConvertibleKind;
  readonly convert: (
    itemId: Uuid,
    targetKind: ConvertibleKind,
    confirmedDestruction: boolean,
  ) => Promise<ConvertOutcome>;
  readonly finalFocus?: RefObject<HTMLElement | null>;
  readonly variant?: "button" | "menu";
}) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const target: ConvertibleKind = kind === "page" ? "folder" : "page";

  const close = useCallback(() => {
    setConfirming(false);
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
      setError(outcome.message ?? "La conversion n’a pas abouti.");
    },
    [convert, itemId, target],
  );

  return (
    <DialogRoot
      open={confirming}
      setOpen={(open) => {
        if (!open) close();
      }}
    >
      {variant === "menu" ? (
        <MenuItem
          ref={trigger as Ref<HTMLDivElement>}
          disabled={pending}
          data-testid={`convert-${itemName}`}
          onClick={(event) => {
            event.stopPropagation();
            void run(false);
          }}
        >
          <AppIcon name={kind === "page" ? "folder" : "fileText"} size="small" />
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
          <AppIcon name={kind === "page" ? "folder" : "fileText"} size="small" />
          <span className="ui-visually-hidden">{kind === "page" ? "en dossier" : "en page"}</span>
        </button>
      )}

      {confirming ? (
        <DialogContent
          role="alertdialog"
          finalFocus={finalFocus ?? trigger}
          size="medium"
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
            <Button data-testid="cancel-convert" onClick={close}>
              Conserver cette page
            </Button>
          </div>
        </DialogContent>
      ) : null}

      {error !== null ? <AsyncState compact kind="error" description={error} /> : null}
    </DialogRoot>
  );
}
