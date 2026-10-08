import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7, linkedDatabasePageName, type Uuid } from "@myownnotion/domain";
import { useEffect, useRef, useState } from "react";
import type { LocalContentService } from "../../../services/local-content.ts";
import { safeKeyBetween } from "../../../services/ordering.ts";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import {
  DatabaseCreateChoiceDialog,
  type DatabaseSourceOption,
} from "../../databases/database-create-choice.tsx";
import type { EditorInstance } from "../blocknote-schema.ts";
import type { CreateInlineDatabase } from "./slash-menu.tsx";

export function IntegratedDatabasePicker({
  blockId,
  parentItemId,
  items,
  service,
  editor,
  createDatabase,
  onClose,
}: {
  readonly blockId: string;
  readonly parentItemId: Uuid;
  readonly items: readonly ProjectedItem[];
  readonly service: LocalContentService;
  readonly editor: EditorInstance;
  readonly createDatabase?: CreateInlineDatabase | undefined;
  readonly onClose: () => void;
}) {
  const copy = FR_COPY.editor.databaseInsertion;
  const [mode, setMode] = useState<"choose" | "existing">("choose");
  const [sources, setSources] = useState<DatabaseSourceOption[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [viewId] = useState(generateUuidV7);
  const [created, setCreated] = useState<{ id: string; viewId: string } | null>(null);
  const result = useRef(created);
  const pending = useRef(false);
  const anchor = useRef(JSON.stringify(editor.getBlock(blockId)));

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is the explicit retry generation for this local read.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSourcesError(null);
    void service
      .listDatabases()
      .then((rows) => {
        if (!active) return;
        const byId = new Map(items.map((item) => [item.id, item]));
        const options = rows.flatMap((row) => {
          const owner = byId.get(row.itemId);
          if (
            row.sourceId === undefined ||
            owner?.kind !== "database" ||
            owner.lifecycle !== "active"
          )
            return [];
          const name = row.definition.name?.trim() || owner.name;
          return [
            { id: row.sourceId, name: name === owner.name ? name : `${owner.name} / ${name}` },
          ];
        });
        setSources(options);
        setSourceId((current) =>
          options.some((option) => option.id === current) ? current : (options[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (active) {
          setSources([]);
          setSourceId("");
          setSourcesError(copy.unavailable);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [items, service, reload, copy.unavailable]);

  const confirm = async (kind: "new" | "existing") => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const current = editor.getBlock(blockId);
      if (current === undefined || JSON.stringify(current) !== anchor.current)
        throw Error(copy.missingBlock);
      if (result.current === null) {
        let value: { id: string; viewId: string };
        if (kind === "new") {
          if (createDatabase === undefined)
            throw Error(FR_COPY.editor.slashMenu.inlineDatabase.creationFailed);
          value = await createDatabase({
            id: blockId,
            title: FR_COPY.editor.slashMenu.fullPageDatabase.defaultTitle,
            initialViewId: viewId,
          });
        } else {
          const selected = sources.find((source) => source.id === sourceId);
          if (selected === undefined) throw Error(copy.missingSource);
          const id = blockId as Uuid;
          const existing = await service.getItem(id);
          if (existing !== null) {
            if (
              existing.kind !== "database_view" ||
              existing.lifecycle !== "active" ||
              !existing.placements.some(
                (placement) =>
                  placement.kind === "hierarchy" && placement.parentItemId === parentItemId,
              )
            )
              throw Error(copy.conflict);
            const stored = await service.getDatabase(id);
            const storedView = stored?.presentation?.views.find(
              (view) => view.sourceId === sourceId,
            );
            if (storedView === undefined) throw Error(copy.conflict);
            value = { id, viewId: storedView.id };
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
            const mutation = await service.mutate("database_view.create", {
              id,
              name: linkedDatabasePageName(selected.name),
              sourceId: selected.id,
              placement: {
                id: generateUuidV7(),
                parentItemId,
                positionKey: safeKeyBetween(positions.at(-1) ?? null, null),
              },
              initialViewId: viewId,
            });
            if (!mutation.ok) throw Error(mutation.error.title);
            value = { id, viewId };
          }
        }
        result.current = value;
        setCreated(value);
      }
      if (JSON.stringify(editor.getBlock(blockId)) !== anchor.current)
        throw Error(copy.missingBlock);
      editor.updateBlock(blockId, {
        type: "databaseView",
        props: { containerItemId: result.current.id, viewId: result.current.viewId },
      } as never);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : FR_COPY.editor.slashMenu.inlineDatabase.creationFailed,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <DatabaseCreateChoiceDialog
      open
      variant="inline"
      mode={mode}
      sources={sources}
      sourceId={sourceId}
      busy={busy}
      error={error}
      loadingSources={loading}
      sourcesError={sourcesError}
      insertionReady={created !== null}
      onCancel={onClose}
      onBack={() => setMode("choose")}
      onSourceId={setSourceId}
      onCreateNewSource={() => {
        void confirm("new");
      }}
      onShowExisting={() => setMode("existing")}
      onCreateFromSource={() => {
        void confirm("existing");
      }}
      onRetrySources={() => setReload((value) => value + 1)}
    />
  );
}
