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
import {
  type EditorLinkDialogRequest,
  editorLinkCreationFromSelection,
  selectedEditorLink,
} from "../editor-links.ts";

function MyOwnNotionFormattingToolbar({
  onLinkRequest,
}: {
  readonly onLinkRequest: (request: EditorLinkDialogRequest) => void;
}) {
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const selectedLink = selectedEditorLink(editor);
  const components = useComponentsContext();
  const Toolbar = components?.FormattingToolbar;
  if (Toolbar === undefined) return null;

  const openLinkFlow = (): void => {
    if (selectedLink !== null) {
      onLinkRequest({ mode: "edit", link: selectedLink });
      return;
    }
    const selection = editorLinkCreationFromSelection(editor);
    if (selection !== null) onLinkRequest({ mode: "create", selection });
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
        data-testid="open-link-dialog"
        label={selectedLink === null ? "Ajouter un lien" : "Modifier le lien"}
        mainTooltip={selectedLink === null ? "Ajouter un lien" : "Modifier le lien"}
        icon={<AppIcon name="link" />}
        isSelected={selectedLink !== null}
        onClick={openLinkFlow}
      />
      <ColorStyleButton />
      <NestBlockButton />
      <UnnestBlockButton />
    </FormattingToolbar>
  );
}

/** Floating toolbar with one coherent entry point for page and Web links. */
export function EditorFormattingToolbar({
  onLinkRequest,
}: {
  readonly onLinkRequest: (request: EditorLinkDialogRequest) => void;
}) {
  const components = useComponentsContext();
  const toolbar = useCallback(
    () => <MyOwnNotionFormattingToolbar onLinkRequest={onLinkRequest} />,
    [onLinkRequest],
  );
  if (components === undefined) return null;
  return <FormattingToolbarController formattingToolbar={toolbar} />;
}
