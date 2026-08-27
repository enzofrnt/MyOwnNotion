import type { ProjectedItem } from "@myownnotion/client-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "../../../ui/icons.tsx";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
  Field,
} from "../../../ui/primitives/index.ts";
import type { EditorInstance } from "../blocknote-schema.ts";
import {
  createEditorLink,
  type EditorLinkDialogRequest,
  type EditorPageLinkOption,
  normalizeExternalLinkTarget,
  openEditorLink,
  removeEditorLink,
  resolveEditorLinkTarget,
  updateEditorLink,
} from "../editor-links.ts";

function hierarchyParentId(item: ProjectedItem): ProjectedItem["id"] | null {
  return item.placements.find((placement) => placement.kind === "hierarchy")?.parentItemId ?? null;
}

/** One stable, readable path per page for the shared link target field. */
export function editorPageLinkOptions(
  items: readonly ProjectedItem[],
  currentItemId?: string,
): EditorPageLinkOption[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const pathOf = (item: ProjectedItem): string => {
    const names = [item.name];
    const visited = new Set([item.id]);
    let parentId = hierarchyParentId(item);
    while (parentId !== null && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (parent === undefined) break;
      names.unshift(parent.name);
      parentId = hierarchyParentId(parent);
    }
    return ["Notes", ...names].join(" / ");
  };
  return items
    .filter(
      (item) =>
        item.id !== currentItemId &&
        item.lifecycle === "active" &&
        (item.kind === "page" || item.kind === "folder"),
    )
    .map((item) => ({ id: item.id, name: item.name, path: pathOf(item) }))
    .toSorted((left, right) => left.path.localeCompare(right.path, "fr"));
}

function initialTarget(
  request: EditorLinkDialogRequest | null,
  pages: readonly EditorPageLinkOption[],
): { readonly query: string; readonly selectedPageId: string | null } {
  if (request?.mode !== "edit") return { query: "", selectedPageId: null };
  if (request.link.kind === "external") {
    return { query: request.link.target, selectedPageId: null };
  }
  return {
    query: pages.find((page) => page.id === request.link.target)?.path ?? request.link.target,
    selectedPageId: request.link.target,
  };
}

export function LinkEditorDialog({
  currentItemId,
  editor,
  items,
  request,
  onClose,
  onError,
  onOpenPage,
}: {
  readonly currentItemId: string;
  readonly editor: EditorInstance;
  readonly items: readonly ProjectedItem[];
  readonly request: EditorLinkDialogRequest | null;
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
  readonly onOpenPage?: ((itemId: string) => void) | undefined;
}) {
  const pages = useMemo(() => editorPageLinkOptions(items, currentItemId), [currentItemId, items]);
  const initial = initialTarget(request, pages);
  const [text, setText] = useState(
    request?.mode === "edit" ? request.link.text : (request?.selection.text ?? ""),
  );
  const [targetQuery, setTargetQuery] = useState(initial.query);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(initial.selectedPageId);
  const [validation, setValidation] = useState<string | null>(null);
  const previousRequest = useRef(request);

  useEffect(() => {
    // Synchronization refreshes `items` while the owner is typing. Keep that
    // metadata fresh without resetting a half-written target or selection.
    if (previousRequest.current === request) return;
    previousRequest.current = request;
    const next = initialTarget(request, pages);
    setText(request?.mode === "edit" ? request.link.text : (request?.selection.text ?? ""));
    setTargetQuery(next.query);
    setSelectedPageId(next.selectedPageId);
    setValidation(null);
  }, [pages, request]);

  const candidates = useMemo(() => {
    const normalized = targetQuery.trim().toLocaleLowerCase("fr");
    return pages
      .filter(
        (page) =>
          normalized === "" ||
          page.name.toLocaleLowerCase("fr").includes(normalized) ||
          page.path.toLocaleLowerCase("fr").includes(normalized),
      )
      .slice(0, 10);
  }, [pages, targetQuery]);
  const externalTarget = normalizeExternalLinkTarget(targetQuery);

  if (request === null) return null;

  const finish = (): void => {
    onClose();
    queueMicrotask(() => editor.focus());
  };

  const resolvedTarget = () => {
    if (selectedPageId !== null && pages.some((page) => page.id === selectedPageId)) {
      return { kind: "page" as const, target: selectedPageId };
    }
    return resolveEditorLinkTarget(targetQuery, pages);
  };

  const save = (): void => {
    const target = resolvedTarget();
    const defaultText =
      target?.kind === "page"
        ? (pages.find((page) => page.id === target.target)?.name ?? "")
        : (target?.target ?? "");
    const visibleText = text.trim() || defaultText;
    const saved =
      target !== null &&
      (request.mode === "edit"
        ? updateEditorLink(editor, request.link, { ...target, text: visibleText })
        : createEditorLink(editor, request.selection, { ...target, text: visibleText }));
    if (!saved) {
      setValidation(
        "Choisissez une page, saisissez son nom ou son chemin, ou utilisez une adresse Web valide.",
      );
      return;
    }
    finish();
  };

  const remove = (): void => {
    if (request.mode !== "edit" || !removeEditorLink(editor, request.link)) {
      onError("Ce lien a changé avant sa suppression. Réessayez depuis le texte.");
      return;
    }
    finish();
  };

  return (
    <DialogRoot open setOpen={(open) => !open && finish()}>
      <DialogContent className="editor-link-dialog" size="small" data-testid="link-editor-dialog">
        <DialogDismiss />
        <DialogHeading>
          {request.mode === "edit" ? "Modifier le lien" : "Ajouter un lien"}
        </DialogHeading>
        <DialogDescription>
          Choisissez une page de vos notes ou saisissez une adresse Web. Les contenus intégrés
          restent une action séparée.
        </DialogDescription>
        <Field
          label="Texte affiché"
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setValidation(null);
          }}
        />
        <Field
          autoFocus
          label="Page ou adresse"
          placeholder="Nom de page, chemin ou https://…"
          value={targetQuery}
          error={validation ?? undefined}
          onChange={(event) => {
            setTargetQuery(event.currentTarget.value);
            setSelectedPageId(null);
            setValidation(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && candidates.length === 0 && externalTarget !== null) {
              event.preventDefault();
              save();
            }
          }}
        />
        <div className="editor-link-dialog__results" role="listbox" aria-label="Cibles disponibles">
          {candidates.map((page) => (
            <button
              key={page.id}
              type="button"
              role="option"
              aria-selected={page.id === selectedPageId}
              data-testid={`link-page-option-${page.id}`}
              onClick={() => {
                setSelectedPageId(page.id);
                setTargetQuery(page.path);
                if (text.trim() === "") setText(page.name);
                setValidation(null);
              }}
            >
              <AppIcon name="fileText" size="small" />
              <span>{page.path}</span>
            </button>
          ))}
          {externalTarget === null ? null : (
            <p className="editor-link-dialog__web-target">
              <AppIcon name="link" size="small" />
              Lien Web : {externalTarget}
            </p>
          )}
          {candidates.length === 0 && externalTarget === null ? (
            <p className="muted">Aucune page correspondante</p>
          ) : null}
        </div>
        <div className="editor-link-dialog__actions">
          {request.mode === "edit" ? (
            <>
              <Button variant="ghost" onClick={() => openEditorLink(request.link, onOpenPage)}>
                Ouvrir
              </Button>
              <Button variant="danger" onClick={remove} data-testid="remove-editor-link">
                Retirer le lien
              </Button>
            </>
          ) : null}
          <Button variant="primary" onClick={save} data-testid="save-editor-link">
            {request.mode === "edit" ? "Enregistrer" : "Ajouter"}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
