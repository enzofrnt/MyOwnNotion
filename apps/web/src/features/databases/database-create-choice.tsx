import type { Uuid } from "@myownnotion/domain";
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
}) {
  return (
    <DialogRoot
      open={open}
      setOpen={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent size="small" data-testid="database-create-choice" hideOnEscape={!busy}>
        <DialogHeading>Nouvelle base de données</DialogHeading>
        {mode === "choose" ? (
          <div className="database-create-choice">
            <p>
              Cette page peut créer sa propre source, ou seulement afficher une source déjà
              existante.
            </p>
            <Button type="button" disabled={busy} onClick={onCreateNewSource}>
              Créer une nouvelle source
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || sources.length === 0}
              onClick={onShowExisting}
            >
              Afficher une source existante
            </Button>
            {sources.length === 0 ? (
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
            <p>La page ne possédera pas cette source. Elle l’affichera, et portera une flèche.</p>
            <label>
              Source
              <NativeSelect
                density="compact"
                aria-label="Source existante"
                value={sourceId}
                disabled={busy || sources.length === 0}
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
              <Button type="submit" disabled={busy || sourceId === ""}>
                Créer la page
              </Button>
            </div>
          </form>
        )}
        {error === null ? null : <p role="alert">{error}</p>}
      </DialogContent>
    </DialogRoot>
  );
}
