import type { DatabaseEntryDto } from "@myownnotion/contracts";
import type { DatabaseDefinition } from "@myownnotion/domain";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AsyncState } from "../../ui/primitives/async-state.tsx";
import { Button } from "../../ui/primitives/button.tsx";
import {
  DialogContent,
  DialogDescription,
  DialogHeading,
  DialogRoot,
} from "../../ui/primitives/dialog.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { type EditEntryDefinition, EntrySchemaImpact } from "./edit-entry-properties.ts";
import { type EntryDefinitionEdit, EntryPropertyList } from "./entry-property-list.tsx";
import type { RelationOption } from "./value-editor.tsx";

export type { EntryDrafts } from "./use-entry-autosave.ts";

import { type EntryDrafts, type SaveEntryValues, useEntryAutosave } from "./use-entry-autosave.ts";

export function EntryPanel({
  entry,
  definition,
  valuesAvailable = true,
  relationOptions = [],
  pageContent,
  renderHeader,
  initialDrafts,
  onDraftsChange,
  onSaveValues,
  onEditDefinition,
  onClose,
}: {
  readonly entry: DatabaseEntryDto;
  readonly definition: DatabaseDefinition;
  readonly valuesAvailable?: boolean;
  readonly relationOptions?: readonly RelationOption[];
  readonly pageContent?: ReactNode;
  /** The workspace supplies its canonical title/navigation; drawers use the compact header. */
  readonly renderHeader?: (onClose: () => void) => ReactNode;
  /** Edited fields retained while a transient projection remounts this form. */
  readonly initialDrafts?: EntryDrafts;
  readonly onDraftsChange?: (drafts: EntryDrafts) => void;
  readonly onSaveValues: SaveEntryValues;
  readonly onEditDefinition?: EditEntryDefinition;
  readonly onClose: () => void;
}) {
  const [localDefinition, setLocalDefinition] = useState(definition);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [pendingImpact, setPendingImpact] = useState<{
    error: EntrySchemaImpact;
    edit: (d: DatabaseDefinition) => DatabaseDefinition;
  } | null>(null);
  const retrySchema = useRef<(() => void) | null>(null);
  const schemaQueue = useRef<Promise<unknown>>(Promise.resolve());
  const cancelImpactRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => setLocalDefinition(definition), [definition]);
  const editDefinition: EntryDefinitionEdit = (edit, confirmed = false) => {
    const operation = schemaQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (onEditDefinition === undefined) return;
        setSchemaError(null);
        try {
          setLocalDefinition(await onEditDefinition(edit, confirmed));
          retrySchema.current = null;
        } catch (error) {
          if (error instanceof EntrySchemaImpact) setPendingImpact({ error, edit });
          else {
            setSchemaError(
              error instanceof Error ? error.message : "La propriété n’a pas pu être modifiée.",
            );
            retrySchema.current = () => void editDefinition(edit).catch(() => undefined);
          }
          throw error;
        }
      });
    schemaQueue.current = operation;
    return operation;
  };
  const editableProperties = useMemo(
    () => localDefinition.properties.filter((p) => p.state === "active" && p.type !== "title"),
    [localDefinition],
  );
  const autosave = useEntryAutosave({
    entry,
    properties: editableProperties,
    available: valuesAvailable,
    initialDrafts,
    onDraftsChange,
    onSave: onSaveValues,
  });
  const { drafts, errors } = autosave;

  return (
    <section
      className="entry-panel"
      aria-label={renderHeader === undefined ? undefined : entry.title}
      aria-labelledby={renderHeader === undefined ? `entry-heading-${entry.entryId}` : undefined}
    >
      {renderHeader === undefined ? (
        <header className="entry-panel__header">
          <h2 id={`entry-heading-${entry.entryId}`}>{entry.title}</h2>
          <Button size="compact" variant="ghost" onClick={onClose}>
            {DATABASE_COPY.entry.close}
          </Button>
        </header>
      ) : (
        renderHeader(onClose)
      )}

      <div className="entry-properties">
        {!valuesAvailable ? (
          <AsyncState compact kind="offline" description={DATABASE_COPY.entry.valuesUnavailable} />
        ) : (
          <>
            {editableProperties.length === 0 ? (
              <>
                <AsyncState compact kind="empty" description={DATABASE_COPY.entry.noProperties} />
                <EntryPropertyList
                  definition={localDefinition}
                  drafts={drafts}
                  errors={errors}
                  options={relationOptions}
                  edit={onEditDefinition === undefined ? undefined : editDefinition}
                  onChange={autosave.update}
                  onBlur={autosave.flush}
                />
              </>
            ) : (
              <EntryPropertyList
                definition={localDefinition}
                drafts={drafts}
                errors={errors}
                options={relationOptions.filter((o) => o.id !== entry.entryId)}
                edit={onEditDefinition === undefined ? undefined : editDefinition}
                onChange={autosave.update}
                onBlur={autosave.flush}
              />
            )}
            <div
              className="entry-properties__status"
              data-save-state={autosave.state}
              role="status"
              aria-live="polite"
            >
              {autosave.state === "saving" ? DATABASE_COPY.common.savingLocally : null}
            </div>
            {autosave.error !== null ? (
              <div className="entry-properties__error" role="alert">
                <span>{autosave.error}</span>
                <Button size="compact" variant="ghost" onClick={autosave.retry}>
                  Réessayer
                </Button>
                <Button size="compact" variant="ghost" onClick={autosave.useCurrentValues}>
                  Utiliser les valeurs actuelles
                </Button>
              </div>
            ) : null}
          </>
        )}
        {schemaError === null ? null : (
          <div className="entry-properties__schema-error" role="alert">
            <span>{schemaError}</span>
            <Button size="compact" variant="ghost" onClick={() => retrySchema.current?.()}>
              Réessayer
            </Button>
          </div>
        )}
      </div>
      <DialogRoot open={pendingImpact !== null} setOpen={(open) => !open && setPendingImpact(null)}>
        <DialogContent size="small" initialFocus={cancelImpactRef} unmountOnHide>
          <DialogHeading className="entry-property-impact__heading">
            Modifier cette propriété ?
          </DialogHeading>
          <DialogDescription>
            {pendingImpact === null
              ? null
              : DATABASE_COPY.page.impact(
                  pendingImpact.error.impact.affectedValueCount,
                  pendingImpact.error.impact.affectedEntryCount,
                )}{" "}
            Les valeurs incompatibles seront conservées pour récupération.
          </DialogDescription>
          <div className="ui-dialog__actions">
            <Button
              variant="danger"
              onClick={() => {
                const pending = pendingImpact;
                setPendingImpact(null);
                if (pending !== null)
                  void editDefinition(pending.edit, true).catch(() => undefined);
              }}
            >
              Confirmer la modification
            </Button>
            <Button ref={cancelImpactRef} variant="ghost" onClick={() => setPendingImpact(null)}>
              Annuler
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
      <section className="entry-document" aria-label={DATABASE_COPY.entry.pageContent}>
        {pageContent ?? <p className="muted">{DATABASE_COPY.entry.samePageDocument}</p>}
      </section>
    </section>
  );
}
