import type { Uuid } from "@myownnotion/domain";
import { type ComponentProps, memo, useMemo } from "react";
import type { CreateSubpage, CreateSubpageRequest } from "../editor/editor-menus/slash-menu.tsx";
import { EditorView } from "../editor/editor-view.tsx";

type CreateChild = (parentId: Uuid, request: CreateSubpageRequest) => ReturnType<CreateSubpage>;
type CreateDatabaseChild = (
  parentId: Uuid,
  request: CreateSubpageRequest,
) => Promise<{
  readonly id: string;
  readonly title: string;
  readonly viewId: string;
}>;

type WorkspacePageEditorProps = Omit<
  ComponentProps<typeof EditorView>,
  "onCreateSubpage" | "onCreateSubfolder" | "onCreateFullPageDatabase" | "onCreateInlineDatabase"
> & {
  readonly createPage: CreateChild;
  readonly createFolder: CreateChild;
  readonly createDatabase: CreateDatabaseChild;
};

/** Sidebar disclosure changes do not invalidate durable editor sessions.
 * Bind commands to the page once, while accepting real data/selection updates. */
export const WorkspacePageEditor = memo(function WorkspacePageEditor({
  createPage,
  createFolder,
  createDatabase,
  itemId,
  ...props
}: WorkspacePageEditorProps) {
  const commands = useMemo(
    () => ({
      onCreateSubpage: (request: CreateSubpageRequest) => createPage(itemId, request),
      onCreateSubfolder: (request: CreateSubpageRequest) => createFolder(itemId, request),
      onCreateFullPageDatabase: (request: CreateSubpageRequest) => createDatabase(itemId, request),
      onCreateInlineDatabase: (request: CreateSubpageRequest) => createDatabase(itemId, request),
    }),
    [createPage, createFolder, createDatabase, itemId],
  );
  return <EditorView {...props} {...commands} itemId={itemId} />;
});
