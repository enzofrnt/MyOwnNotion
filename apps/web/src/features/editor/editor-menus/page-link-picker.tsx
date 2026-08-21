import { useBlockNoteEditor, useComponentsContext } from "@blocknote/react";
import type { ProjectedItem } from "@myownnotion/client-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "../../../ui/icons.tsx";
import type { EditorInstance } from "../blocknote-schema.ts";

const PAGE_LINK_PREFIX = "myownnotion:page:";

export function PageLinkPicker({
  currentItemId,
  items,
}: {
  readonly currentItemId: string;
  readonly items: readonly ProjectedItem[];
}) {
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const components = useComponentsContext();
  const [open, setOpen] = useState(false);
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
  const Toolbar = components.FormattingToolbar;

  const insert = (item: ProjectedItem): void => {
    const selectedText = editor.getSelectedText().trim();
    editor.createLink(`${PAGE_LINK_PREFIX}${item.id}`, selectedText || item.name);
    setQuery("");
    setOpen(false);
    editor.focus();
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Toolbar.Button
          className="bn-button"
          data-testid="open-page-link-picker"
          label="Lien vers une page"
          mainTooltip="Lien vers une page"
          icon={<AppIcon name="fileText" />}
          onClick={() => setOpen((value) => !value)}
        />
      </Popover.Trigger>
      <Popover.Content
        className="bn-popover-content editor-page-link-picker"
        variant="panel-popover"
      >
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
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => insert(item)}
              >
                <AppIcon name={item.kind === "folder" ? "folder" : "fileText"} />
                <span>{item.name}</span>
              </button>
            ))
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
