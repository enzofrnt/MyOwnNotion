import type { Uuid } from "@myownnotion/domain";
import { FR_COPY } from "../../ui/copy/fr.ts";
import { Button, DialogContent, DialogHeading, DialogRoot } from "../../ui/primitives/index.ts";
import { NativeSelect } from "../../ui/primitives/native-select.tsx";

export interface DatabaseSourceOption {
  readonly id: Uuid;
  readonly name: string;
}

/**
 * The two ways to create a database page: a source this page will own, or a
 * page that only displays a source that already exists.
 */
export function DatabaseCreateChoiceDialog({
  open,
  mode,
  sources,
  sourceId,
  busy,
  error,
  onCancel,
  onCreateNewSource,
  onShowExisting,
  onSourceId,
  onCreateFromSource,
  onBack,
  variant = "page",
  loadingSources = false,
  sourcesError = null,
  onRetrySources,
  insertionReady = false,
}: {
  readonly open: boolean;
  readonly mode: "choose" | "existing";
  readonly sources: readonly DatabaseSourceOption[];
  readonly sourceId: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onCreateNewSource: () => void;
  readonly onShowExisting: () => void;
  readonly onSourceId: (sourceId: string) => void;
  readonly onCreateFromSource: () => void;
  readonly onBack: () => void;
  readonly variant?: "page" | "inline";
  readonly loadingSources?: boolean;
  readonly sourcesError?: string | null;
  readonly onRetrySources?: () => void;
  readonly insertionReady?: boolean;
}) {
  const copy = FR_COPY.editor.databaseInsertion;
  return (
    <DialogRoot
      open={open}
      setOpen={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent
        size="small"
        data-testid="database-create-choice"
        hideOnEscape={!busy}
        aria-busy={busy}
      >
        <DialogHeading>
          {variant === "inline"
            ? FR_COPY.editor.slashMenu.inlineDatabase.title
            : "Nouvelle base de données"}
        </DialogHeading>
        {insertionReady ? (
          <div className="database-create-choice">
            <Button type="button" disabled={busy} onClick={onCreateNewSource}>
              {copy.retryInsertion}
            </Button>
          </div>
        ) : mode === "choose" ? (
          <div className="database-create-choice">
            <p>
              {variant === "inline"
                ? copy.description
                : "Cette page peut créer sa propre source, ou seulement afficher une source déjà existante."}
            </p>
            <Button type="button" disabled={busy} onClick={onCreateNewSource}>
              {busy ? copy.creating : "Créer une nouvelle source"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || loadingSources || sources.length === 0}
              onClick={onShowExisting}
            >
              Afficher une source existante
            </Button>
            {!loadingSources && sourcesError === null && sources.length === 0 ? (
              <p className="muted">Aucune source existante pour le moment.</p>
            ) : null}
          </div>
        ) : (
          <form
            className="database-create-choice"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateFromSource();
            }}
          >
            <p>
              {variant === "inline"
                ? copy.existingDescription
                : "La page ne possédera pas cette source. Elle l’affichera, et portera une flèche."}
            </p>
            <label>
              Source
              <NativeSelect
                density="compact"
                aria-label="Source existante"
                value={sourceId}
                disabled={busy || loadingSources || sources.length === 0}
                onChange={(event) => onSourceId(event.target.value)}
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <div className="database-create-choice__actions">
              <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
                Retour
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  loadingSources ||
                  sourceId === "" ||
                  !sources.some((source) => source.id === sourceId)
                }
              >
                {busy ? copy.creating : variant === "inline" ? copy.insert : "Créer la page"}
              </Button>
            </div>
          </form>
        )}
        {loadingSources ? <p role="status">{copy.loading}</p> : null}
        {sourcesError === null ? null : <p role="alert">{sourcesError}</p>}
        {sourcesError !== null && onRetrySources !== undefined ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy || loadingSources}
            onClick={onRetrySources}
          >
            {copy.retrySources}
          </Button>
        ) : null}
        {error === null ? null : <p role="alert">{error}</p>}
        {variant === "inline" ? (
          <div className="ui-dialog__actions">
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
              Annuler
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </DialogRoot>
  );
}
