import {
  BasicTextStyleButton,
  ColorStyleButton,
  FormattingToolbar,
  FormattingToolbarController,
  NestBlockButton,
  UnnestBlockButton,
  useBlockNoteEditor,
  useComponentsContext,
} from "@blocknote/react";
import { type RefObject, useCallback, useEffect } from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import { AppIcon } from "../../../ui/icons.tsx";
import type { EditorInstance } from "../blocknote-schema.ts";
import {
  type EditorLinkCreation,
  editorLinkCreationFromSelection,
  selectedEditorLink,
} from "../editor-links.ts";
import type { PageLinkPickerRequest } from "./page-link-picker.tsx";

function isTextSelection(selection: EditorLinkCreation | null): selection is EditorLinkCreation {
  return selection !== null && selection.from < selection.to && selection.text.trim().length > 0;
}

const toolbarFloatingOptions = {
  elementProps: { className: "editor-formatting-toolbar-positioner" },
};

function MyOwnNotionFormattingToolbar({
  onPageLinkRequest,
  onWebBookmarkRequest,
  preservedSelection,
}: {
  readonly onPageLinkRequest: (request: PageLinkPickerRequest) => void;
  readonly onWebBookmarkRequest: () => void;
  readonly preservedSelection: RefObject<EditorLinkCreation | null>;
}) {
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const selectedLink = selectedEditorLink(editor);
  const components = useComponentsContext();
  const Toolbar = components?.FormattingToolbar;
  const currentSelection = editorLinkCreationFromSelection(editor);
  useEffect(() => {
    if (isTextSelection(currentSelection)) preservedSelection.current = currentSelection;
  }, [currentSelection, preservedSelection]);
  const cursorBlockType = ((): string | null => {
    try {
      return editor.getTextCursorPosition().block.type;
    } catch {
      return null;
    }
  })();
  if (Toolbar === undefined || cursorBlockType === "databaseView") return null;

  const openPageLinkFlow = (): void => {
    if (selectedLink?.kind === "page") {
      onPageLinkRequest({ mode: "edit", link: selectedLink });
      return;
    }
    const selection = editorLinkCreationFromSelection(editor);
    const usableSelection = isTextSelection(selection)
      ? selection
      : isTextSelection(currentSelection)
        ? currentSelection
        : preservedSelection.current;
    if (usableSelection !== null) onPageLinkRequest({ mode: "create", selection: usableSelection });
  };
  const rememberPageLinkSelection = (): void => {
    const selection = editorLinkCreationFromSelection(editor);
    if (isTextSelection(selection)) preservedSelection.current = selection;
  };

  return (
    <FormattingToolbar>
      <BasicTextStyleButton basicTextStyle="bold" />
      <BasicTextStyleButton basicTextStyle="italic" />
      <BasicTextStyleButton basicTextStyle="underline" />
      <BasicTextStyleButton basicTextStyle="strike" />
      <BasicTextStyleButton basicTextStyle="code" />
      <span className="bn-page-link-action" onPointerDownCapture={rememberPageLinkSelection}>
        <Toolbar.Button
          className="bn-button"
          data-testid="open-page-link-picker"
          label={
            selectedLink?.kind === "page"
              ? FR_COPY.editor.itemLink.edit
              : FR_COPY.editor.slashMenu.pageLink.title
          }
          mainTooltip={FR_COPY.editor.slashMenu.pageLink.title}
          icon={<AppIcon name="reference" />}
          isSelected={selectedLink?.kind === "page"}
          onClick={openPageLinkFlow}
        />
      </span>
      <Toolbar.Button
        className="bn-button"
        data-testid="open-web-bookmark-dialog"
        label="Lien Web"
        mainTooltip="Lien Web"
        icon={<AppIcon name="link" />}
        isSelected={false}
        onClick={onWebBookmarkRequest}
      />
      <ColorStyleButton />
      <NestBlockButton />
      <UnnestBlockButton />
    </FormattingToolbar>
  );
}

/** Floating toolbar with two explicit interactions: internal page or Web card. */
export function EditorFormattingToolbar({
  onPageLinkRequest,
  onWebBookmarkRequest,
  preservedSelection,
}: {
  readonly onPageLinkRequest: (request: PageLinkPickerRequest) => void;
  readonly onWebBookmarkRequest: () => void;
  readonly preservedSelection: RefObject<EditorLinkCreation | null>;
}) {
  const components = useComponentsContext();
  const toolbar = useCallback(
    () => (
      <MyOwnNotionFormattingToolbar
        onPageLinkRequest={onPageLinkRequest}
        onWebBookmarkRequest={onWebBookmarkRequest}
        preservedSelection={preservedSelection}
      />
    ),
    [onPageLinkRequest, onWebBookmarkRequest, preservedSelection],
  );
  if (components === undefined) return null;
  return (
    <FormattingToolbarController
      formattingToolbar={toolbar}
      floatingUIOptions={toolbarFloatingOptions}
    />
  );
}
