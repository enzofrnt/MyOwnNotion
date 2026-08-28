import type { ProjectedItem } from "@myownnotion/client-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { ItemIcon } from "../../../ui/item-icon.tsx";
import {
  Button,
  DialogContent,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
} from "../../../ui/primitives/index.ts";
import type { EditorInstance } from "../blocknote-schema.ts";
import {
  createEditorLink,
  type EditorLinkCreation,
  type EditorLinkDescriptor,
  type EditorPageLinkOption,
  openEditorLink,
  removeEditorLink,
  updateEditorLink,
} from "../editor-links.ts";

export type PageLinkPickerRequest =
  | { readonly mode: "create"; readonly selection: EditorLinkCreation }
  | {
      readonly mode: "edit";
      readonly link: Extract<EditorLinkDescriptor, { readonly kind: "page" }>;
    };

function hierarchyParentId(item: ProjectedItem): ProjectedItem["id"] | null {
  return item.placements.find((placement) => placement.kind === "hierarchy")?.parentItemId ?? null;
}

export function pageLinkOptions(
  items: readonly ProjectedItem[],
  currentItemId: string,
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
    .map((item) => ({
      id: item.id,
      name: item.name,
      path: pathOf(item),
      kind: item.kind as "page" | "folder",
      icon: item.icon,
      parentItemId: hierarchyParentId(item),
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path, "fr"));
}

export function matchingPageLinkOptions(
  options: readonly EditorPageLinkOption[],
  query: string,
): EditorPageLinkOption[] {
  const normalized = query.trim().toLocaleLowerCase("fr");
  return options
    .filter(
      (option) =>
        normalized === "" ||
        option.name.toLocaleLowerCase("fr").includes(normalized) ||
        option.path.toLocaleLowerCase("fr").includes(normalized),
    )
    .slice(0, 12);
}

export function PageLinkPicker({
  currentItemId,
  editor,
  items,
  onClose,
  onError,
  onOpenPage,
  request,
}: {
  readonly currentItemId: string;
  readonly editor: EditorInstance;
  readonly items: readonly ProjectedItem[];
  readonly request: PageLinkPickerRequest | null;
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
  readonly onOpenPage?: ((itemId: string) => void) | undefined;
}) {
  const options = useMemo(() => pageLinkOptions(items, currentItemId), [currentItemId, items]);
  const initialQuery =
    request?.mode === "edit"
      ? (options.find((option) => option.id === request.link.target)?.name ?? "")
      : "";
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const [validation, setValidation] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const previousRequest = useRef(request);

  useEffect(() => {
    if (previousRequest.current === request) return;
    previousRequest.current = request;
    const next =
      request?.mode === "edit"
        ? (options.find((option) => option.id === request.link.target)?.name ?? "")
        : "";
    if (input.current !== null) input.current.value = next;
    setQuery(next);
    setActiveIndex(0);
    setValidation(null);
  }, [options, request]);

  if (request === null) return null;
  const candidates = matchingPageLinkOptions(options, query);
  const selectedIndex = Math.min(activeIndex, Math.max(0, candidates.length - 1));

  const finish = (): void => {
    onClose();
    queueMicrotask(() => editor.focus());
  };
  const choose = (option: EditorPageLinkOption): void => {
    const update = { kind: "page" as const, target: option.id, text: option.name };
    const saved =
      request.mode === "edit"
        ? updateEditorLink(editor, request.link, update)
        : createEditorLink(editor, request.selection, update);
    if (!saved) {
      setValidation("Le lien n’a pas pu être créé à cet emplacement.");
      return;
    }
    finish();
  };

  return (
    <DialogRoot open setOpen={(open) => !open && finish()}>
      <DialogContent
        className="page-link-picker"
        size="small"
        data-testid="page-link-picker"
        initialFocus={input}
      >
        <DialogHeading>
          {request.mode === "edit" ? "Modifier le lien vers une page" : "Lien vers une page"}
        </DialogHeading>
        <DialogDismiss />
        <input
          ref={input}
          className="page-link-picker__query"
          type="search"
          defaultValue={initialQuery}
          placeholder="Rechercher une page…"
          aria-label="Rechercher une page"
          aria-controls="page-link-picker-results"
          aria-activedescendant={
            candidates[selectedIndex] === undefined
              ? undefined
              : `page-link-option-${candidates[selectedIndex]?.id}`
          }
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActiveIndex(0);
            setValidation(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, candidates.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const candidate = candidates[selectedIndex];
              if (candidate === undefined)
                setValidation("Aucune page ne correspond à cette recherche.");
              else choose(candidate);
            }
          }}
        />
        {validation === null ? null : <p className="page-link-picker__error">{validation}</p>}
        <div
          id="page-link-picker-results"
          className="page-link-picker__results"
          role="listbox"
          aria-label="Pages disponibles"
        >
          {candidates.map((option, index) => (
            <button
              key={option.id}
              id={`page-link-option-${option.id}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              data-testid={`page-link-option-${option.id}`}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <ItemIcon kind={option.kind ?? "page"} icon={option.icon ?? null} />
              <span>
                <strong>{option.name}</strong>
                <small>{option.path}</small>
              </span>
            </button>
          ))}
          {candidates.length === 0 ? <p>Aucune page correspondante</p> : null}
        </div>
        {request.mode === "edit" ? (
          <div className="page-link-picker__actions">
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => openEditorLink(request.link, onOpenPage)}
            >
              Ouvrir
            </Button>
            <Button
              type="button"
              size="compact"
              variant="ghost"
              data-testid="remove-page-link"
              onClick={() => {
                if (!removeEditorLink(editor, request.link)) {
                  onError("Ce lien a changé avant sa suppression. Réessayez depuis la page.");
                  return;
                }
                finish();
              }}
            >
              Retirer le lien
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </DialogRoot>
  );
}
