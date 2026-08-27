import { FormattingToolbarExtension, ShowSelectionExtension } from "@blocknote/core/extensions";
import {
  BasicTextStyleButton,
  ColorStyleButton,
  CreateLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  NestBlockButton,
  UnnestBlockButton,
  useBlockNoteEditor,
  useComponentsContext,
  useExtension,
} from "@blocknote/react";
import type { ProjectedItem } from "@myownnotion/client-core";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppIcon } from "../../../ui/icons.tsx";
import type { EditorInstance } from "../blocknote-schema.ts";
import { type EditorLinkDescriptor, selectedEditorLink } from "../editor-links.ts";
import {
  PageLinkPickerButton,
  PageLinkPickerContent,
  type PageLinkSelectionRange,
} from "./page-link-picker.tsx";

interface ToolbarInputs {
  readonly currentItemId: string;
  readonly items: readonly ProjectedItem[];
  readonly pageLinkOpen: boolean;
  readonly setPageLinkOpen: (open: boolean) => void;
  readonly onEditLink: (link: EditorLinkDescriptor) => void;
}

interface ToolbarInputStore {
  readonly getSnapshot: () => ToolbarInputs;
  readonly subscribe: (listener: () => void) => () => void;
  readonly update: (next: ToolbarInputs) => void;
}

function createToolbarInputStore(initial: ToolbarInputs): ToolbarInputStore {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (next) => {
      if (
        next.currentItemId === snapshot.currentItemId &&
        next.items === snapshot.items &&
        next.pageLinkOpen === snapshot.pageLinkOpen &&
        next.setPageLinkOpen === snapshot.setPageLinkOpen &&
        next.onEditLink === snapshot.onEditLink
      )
        return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

function MyOwnNotionFormattingToolbar({ inputs }: { readonly inputs: ToolbarInputStore }) {
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const { onEditLink, pageLinkOpen, setPageLinkOpen } = useSyncExternalStore(
    inputs.subscribe,
    inputs.getSnapshot,
    inputs.getSnapshot,
  );
  const selectedLink = selectedEditorLink(editor);
  const components = useComponentsContext();
  const Toolbar = components?.FormattingToolbar;
  return (
    <FormattingToolbar>
      <BasicTextStyleButton basicTextStyle="bold" />
      <BasicTextStyleButton basicTextStyle="italic" />
      <BasicTextStyleButton basicTextStyle="underline" />
      <BasicTextStyleButton basicTextStyle="strike" />
      <BasicTextStyleButton basicTextStyle="code" />
      <CreateLinkButton />
      {selectedLink?.kind === "page" && Toolbar !== undefined ? (
        <Toolbar.Button
          className="bn-button"
          data-testid="edit-selected-page-link"
          label="Modifier le lien vers une page"
          mainTooltip="Modifier le lien vers une page"
          icon={<AppIcon name="link" />}
          onClick={() => onEditLink(selectedLink)}
        />
      ) : (
        <PageLinkPickerButton open={pageLinkOpen} onOpenChange={setPageLinkOpen} />
      )}
      <ColorStyleButton />
      <NestBlockButton />
      <UnnestBlockButton />
    </FormattingToolbar>
  );
}

/** Floating toolbar shared by text styles, external links, page links and canonical colours. */
export function EditorFormattingToolbar({
  currentItemId,
  items,
  onEditLink,
}: {
  readonly currentItemId: string;
  readonly items: readonly ProjectedItem[];
  readonly onEditLink: (link: EditorLinkDescriptor) => void;
}) {
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const components = useComponentsContext();
  const formattingToolbar = useExtension(FormattingToolbarExtension);
  const { showSelection } = useExtension(ShowSelectionExtension);
  const [pageLinkOpen, setPageLinkOpenState] = useState(false);
  const pageLinkOpenRef = useRef(false);
  const pageLinkSelection = useRef<PageLinkSelectionRange | null>(null);
  const setPageLinkOpen = useCallback(
    (open: boolean): void => {
      const opening = open && !pageLinkOpenRef.current;
      pageLinkOpenRef.current = open;
      if (open) {
        if (opening) {
          const { from, to } = editor.prosemirrorState.selection;
          pageLinkSelection.current = { from, to };
        }
        formattingToolbar.store.setState(true);
      }
      setPageLinkOpenState(open);
    },
    [editor, formattingToolbar.store],
  );
  const [inputs] = useState(() =>
    createToolbarInputStore({
      currentItemId,
      items,
      onEditLink,
      pageLinkOpen,
      setPageLinkOpen,
    }),
  );
  useEffect(
    () => inputs.update({ currentItemId, items, onEditLink, pageLinkOpen, setPageLinkOpen }),
    [currentItemId, inputs, items, onEditLink, pageLinkOpen, setPageLinkOpen],
  );

  useEffect(() => {
    // BlockNote derives toolbar visibility from the editor selection. Keep
    // that derivation authoritative normally, but do not let an unrelated
    // synchronization transaction destroy an open picker and its query.
    return formattingToolbar.store.subscribe(({ currentVal }) => {
      if (pageLinkOpenRef.current && !currentVal) formattingToolbar.store.setState(true);
    });
  }, [formattingToolbar.store]);

  useEffect(() => {
    showSelection(pageLinkOpen, "pageLinkPicker");
    return () => showSelection(false, "pageLinkPicker");
  }, [pageLinkOpen, showSelection]);

  // FormattingToolbarController treats this callback as a component type.
  // Its identity therefore stays stable for the editor's whole lifetime. The
  // store updates the mounted picker in place when synchronization refreshes
  // item metadata, preserving its query, focus and text selection.
  const toolbar = useCallback(() => <MyOwnNotionFormattingToolbar inputs={inputs} />, [inputs]);
  if (components === undefined) return null;
  const Popover = components.Generic.Popover;
  return (
    <Popover.Root open={pageLinkOpen} onOpenChange={setPageLinkOpen}>
      <FormattingToolbarController formattingToolbar={toolbar} />
      <PageLinkPickerContent
        currentItemId={currentItemId}
        items={items}
        open={pageLinkOpen}
        onOpenChange={setPageLinkOpen}
        selectionRange={pageLinkSelection}
      />
    </Popover.Root>
  );
}
