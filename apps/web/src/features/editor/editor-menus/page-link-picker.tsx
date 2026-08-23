import { useBlockNoteEditor, useComponentsContext } from "@blocknote/react";
import type { ProjectedItem } from "@myownnotion/client-core";
import {
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppIcon } from "../../../ui/icons.tsx";
import { StableActionButton } from "../../../ui/stable-action-button.tsx";
import type { EditorInstance } from "../blocknote-schema.ts";

/** Wraps one text selection without flattening any of its existing styles. */
export interface PageLinkSelectionRange {
  readonly from: number;
  readonly to: number;
}

function wrapSelectionInPageLink(
  editor: EditorInstance,
  targetItemId: string,
  range: PageLinkSelectionRange,
): boolean {
  return editor.transact((transaction) => {
    const { from, to } = range;
    if (from === to || from < 0 || to > transaction.doc.content.size) return false;
    const pageLink = editor.pmSchema.nodes["pageLink"];
    if (pageLink === undefined) return false;
    const selected = transaction.doc.slice(from, to).content;
    if (!pageLink.validContent(selected)) return false;
    transaction.replaceWith(from, to, pageLink.create({ targetItemId }, selected));
    return true;
  });
}

export function PageLinkPickerButton({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const components = useComponentsContext();
  if (components === undefined) return null;
  const Popover = components.Generic.Popover;
  const Toolbar = components.FormattingToolbar;

  const openFromPointer = (event: PointerEvent): void => {
    // The formatting toolbar is selection-driven and can legitimately be
    // recalculated between pointerdown and click while a background page
    // acknowledgement lands. Open on the first event and keep focus in the
    // editor; otherwise WebKit can remove the trigger before `click` exists.
    event.preventDefault();
    onOpenChange(true);
  };
  const openFromKeyboard = (event: MouseEvent): void => {
    // Ariakit's disclosure also toggles itself. Cancelling its default after
    // setting the controlled state prevents a remounted trigger from turning
    // the picker straight back off between pointerdown and click.
    event.preventDefault();
    onOpenChange(true);
  };

  return (
    <Popover.Trigger>
      <Toolbar.Button
        {...({ onPointerDown: openFromPointer } as Record<string, unknown>)}
        className="bn-button"
        data-testid="open-page-link-picker"
        label="Lien vers une page"
        mainTooltip="Lien vers une page"
        icon={<AppIcon name="fileText" />}
        isSelected={open}
        onClick={openFromKeyboard}
      />
    </Popover.Trigger>
  );
}

export function PageLinkPickerContent({
  currentItemId,
  items,
  open,
  onOpenChange,
  selectionRange,
}: {
  readonly currentItemId: string;
  readonly items: readonly ProjectedItem[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selectionRange: RefObject<PageLinkSelectionRange | null>;
}) {
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const components = useComponentsContext();
  const [query, setQuery] = useState("");
  const queryRef = useRef<HTMLInputElement>(null);
  const candidates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr");
    return items
      .filter(
        (item) =>
          item.id !== currentItemId &&
          item.lifecycle === "active" &&
          (item.kind === "page" || item.kind === "folder") &&
          (normalized === "" || item.name.toLocaleLowerCase("fr").includes(normalized)),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "fr"))
      .slice(0, 12);
  }, [currentItemId, items, query]);

  useEffect(() => {
    if (open) queryRef.current?.focus();
  }, [open]);

  if (components === undefined) return null;
  const Popover = components.Generic.Popover;

  const insert = (item: ProjectedItem): void => {
    const selectedRange = selectionRange.current;
    const inserted =
      selectedRange !== null && selectedRange.from !== selectedRange.to
        ? wrapSelectionInPageLink(editor, item.id, selectedRange)
        : (() => {
            editor.insertInlineContent(
              [
                {
                  type: "pageLink",
                  props: { targetItemId: item.id },
                  content: item.name,
                },
              ] as unknown as Parameters<typeof editor.insertInlineContent>[0],
              { updateSelection: true },
            );
            return true;
          })();
    // A cross-block or otherwise invalid range is left untouched; replacing
    // it with flattened text would be silent data loss.
    if (!inserted) return;
    selectionRange.current = null;
    setQuery("");
    onOpenChange(false);
    editor.focus();
  };

  return (
    <Popover.Content className="bn-popover-content editor-page-link-picker" variant="panel-popover">
      <label htmlFor="editor-page-link-query">Lien vers une page</label>
      <input
        id="editor-page-link-query"
        ref={queryRef}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Rechercher une page…"
        autoComplete="off"
      />
      <div className="editor-page-link-results" role="listbox" aria-label="Pages disponibles">
        {candidates.length === 0 ? (
          <p className="muted">Aucune page correspondante</p>
        ) : (
          candidates.map((item) => (
            <StableActionButton
              key={item.id}
              type="button"
              role="option"
              aria-selected="false"
              onActivate={() => insert(item)}
            >
              <AppIcon name={item.kind === "folder" ? "folder" : "fileText"} />
              <span>{item.name}</span>
            </StableActionButton>
          ))
        )}
      </div>
    </Popover.Content>
  );
}
