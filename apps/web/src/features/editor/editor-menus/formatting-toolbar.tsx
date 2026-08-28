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
  if (Toolbar === undefined) return null;

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
            selectedLink?.kind === "page" ? "Modifier le lien vers la page" : "Lien vers une page"
          }
          mainTooltip="Lien vers une page"
          icon={<AppIcon name="fileText" />}
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
  return <FormattingToolbarController formattingToolbar={toolbar} />;
}
