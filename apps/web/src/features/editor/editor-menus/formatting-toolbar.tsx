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
import { useCallback } from "react";
import { AppIcon } from "../../../ui/icons.tsx";
import type { EditorInstance } from "../blocknote-schema.ts";
import { editorLinkCreationFromSelection, selectedEditorLink } from "../editor-links.ts";
import type { PageLinkPickerRequest } from "./page-link-picker.tsx";

function MyOwnNotionFormattingToolbar({
  onPageLinkRequest,
  onWebBookmarkRequest,
}: {
  readonly onPageLinkRequest: (request: PageLinkPickerRequest) => void;
  readonly onWebBookmarkRequest: () => void;
}) {
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const selectedLink = selectedEditorLink(editor);
  const components = useComponentsContext();
  const Toolbar = components?.FormattingToolbar;
  if (Toolbar === undefined) return null;

  const openPageLinkFlow = (): void => {
    if (selectedLink?.kind === "page") {
      onPageLinkRequest({ mode: "edit", link: selectedLink });
      return;
    }
    const selection = editorLinkCreationFromSelection(editor);
    if (selection !== null) onPageLinkRequest({ mode: "create", selection });
  };

  return (
    <FormattingToolbar>
      <BasicTextStyleButton basicTextStyle="bold" />
      <BasicTextStyleButton basicTextStyle="italic" />
      <BasicTextStyleButton basicTextStyle="underline" />
      <BasicTextStyleButton basicTextStyle="strike" />
      <BasicTextStyleButton basicTextStyle="code" />
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
}: {
  readonly onPageLinkRequest: (request: PageLinkPickerRequest) => void;
  readonly onWebBookmarkRequest: () => void;
}) {
  const components = useComponentsContext();
  const toolbar = useCallback(
    () => (
      <MyOwnNotionFormattingToolbar
        onPageLinkRequest={onPageLinkRequest}
        onWebBookmarkRequest={onWebBookmarkRequest}
      />
    ),
    [onPageLinkRequest, onWebBookmarkRequest],
  );
  if (components === undefined) return null;
  return <FormattingToolbarController formattingToolbar={toolbar} />;
}
