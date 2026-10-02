import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7, linkedDatabasePageName, type Uuid } from "@myownnotion/domain";
import { type FormEvent, useEffect, useState } from "react";
import type { LocalContentService } from "../../../services/local-content.ts";
import { safeKeyBetween } from "../../../services/ordering.ts";
import { Button, DialogContent, DialogHeading, DialogRoot } from "../../../ui/primitives/index.ts";
import type { EditorInstance } from "../blocknote-schema.ts";

interface SourceOption {
  readonly id: Uuid;
  readonly name: string;
}

export function LinkedDatabasePicker({
  blockId,
  parentItemId,
  items,
  service,
  editor,
  onClose,
}: {
  readonly blockId: string | null;
  readonly parentItemId: Uuid;
  readonly items: readonly ProjectedItem[];
  readonly service: LocalContentService;
  readonly editor: EditorInstance;
  readonly onClose: () => void;
}) {
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [sourceId, setSourceId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (blockId === null) return;
    let active = true;
    void service
      .listDatabases()
      .then((rows) => {
        if (!active) return;
        const itemById = new Map(items.map((item) => [item.id, item]));
        const options = rows.flatMap((row) => {
          const item = itemById.get(row.itemId);
          return row.sourceId !== undefined &&
            item?.kind === "database" &&
            item.lifecycle === "active"
            ? [{ id: row.sourceId, name: row.definition.name ?? item.name }]
            : [];
        });
        setSources(options);
        setSourceId((current) => current || options[0]?.id || "");
      })
      .catch(() => setError("Les sources ne sont pas disponibles."));
    return () => {
      active = false;
    };
  }, [blockId, items, service]);
  if (blockId === null) return null;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving || sourceId === "") return;
    setSaving(true);
    setError(null);
    try {
      const id = blockId as Uuid;
      const existing = await service.getItem(id);
      let viewId: Uuid;
      if (existing !== null) {
        if (existing.kind !== "database_view")
          throw new Error("Ce bloc appartient déjà à un autre élément.");
        const stored = await service.getDatabase(id);
        viewId = stored?.presentation?.views[0]?.id ?? generateUuidV7();
      } else {
        const positions = items
          .flatMap((item) =>
            item.placements
              .filter(
                (placement) =>
                  placement.kind === "hierarchy" && placement.parentItemId === parentItemId,
              )
              .map((placement) => placement.positionKey),
          )
          .sort();
        viewId = generateUuidV7();
        const result = await service.mutate("database_view.create", {
          id,
          name: linkedDatabasePageName(
            sources.find((source) => source.id === sourceId)?.name ?? "",
          ),
          sourceId: sourceId as Uuid,
          placement: {
            id: generateUuidV7(),
            parentItemId,
            positionKey: safeKeyBetween(positions.at(-1) ?? null, null),
          },
          initialViewId: viewId,
        });
        if (!result.ok) throw new Error(result.error.title);
      }
      editor.updateBlock(blockId, {
        type: "databaseView",
        props: { containerItemId: id, viewId },
      } as never);
      onClose();
      queueMicrotask(() => editor.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La vue liée n’a pas pu être créée.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogRoot open setOpen={(open) => !open && onClose()}>
      <DialogContent size="small" data-testid="linked-database-picker">
        <DialogHeading>Vue liée de base de données</DialogHeading>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label htmlFor="linked-database-source">Source</label>
          <select
            id="linked-database-source"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            disabled={saving || sources.length === 0}
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
          {sources.length === 0 ? <p>Aucune base disponible.</p> : null}
          {error === null ? null : <p role="alert">{error}</p>}
          <div className="ui-dialog__actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving || sourceId === ""}>
              Insérer la vue
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
