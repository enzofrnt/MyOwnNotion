import { BlockNoteView } from "@blocknote/ariakit";
import type { ProjectedItem } from "@myownnotion/client-core";
import type { BlockDocument, Uuid } from "@myownnotion/domain";
import { canonicalDocumentJsonV3, migrateDocumentV2ToV3 } from "@myownnotion/domain";
import {
  OperationalPageDocument,
  type PageCommand,
  type PageTransactionResult,
  PageUndoManager,
} from "@myownnotion/page-state";
import "@blocknote/ariakit/style.css";
import "@blocknote/core/style.css";
import type { BlockNoteSchema as CommunityBlockNoteSchema, PartialBlock } from "@blocknote/core";
import { fr } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/button.tsx";
import { useTheme } from "../../ui/theme-provider.tsx";
import { validateBlockDrop } from "./block-drag-drop.ts";
import {
  blockNoteBlockToCanonical,
  blockNoteDocumentToCanonical,
  canonicalDocumentToBlockNote,
  canonicalV3ToLegacyV2,
  ensureEditableDocument,
} from "./blocknote-conversion.ts";
import {
  blockNoteSchema,
  type EditorBlock,
  type EditorBlocksChanged,
  type EditorInstance,
} from "./blocknote-schema.ts";
import { commandsFromBlockNoteChanges, EditorChangeBatcher } from "./editor-adapter.ts";
import { BlockContextMenu } from "./editor-menus/block-context-menu.tsx";
import { BlockSideMenu } from "./editor-menus/block-side-menu.tsx";
import { EditorFormattingToolbar } from "./editor-menus/formatting-toolbar.tsx";
import { FrenchSlashMenu } from "./editor-menus/slash-menu.tsx";
import { EditorOriginGuard } from "./editor-remote-apply.ts";
import { historyActionFromInputType, useEditorShortcuts } from "./editor-shortcuts.ts";

const PAGE_LINK_PREFIX = "myownnotion:page:";

function assertVisibleProjection(input: {
  readonly editor: EditorInstance;
  readonly operational: OperationalPageDocument;
  readonly commands: readonly PageCommand[];
  readonly result: PageTransactionResult;
}): void {
  const hasStructuralChange = input.commands.some(
    (command) =>
      command.type === "insert-block" ||
      command.type === "move-block" ||
      command.type === "delete-block",
  );
  if (hasStructuralChange) {
    const expected = canonicalDocumentJsonV3(input.operational.snapshot());
    const visible = canonicalDocumentJsonV3(
      blockNoteDocumentToCanonical(input.editor.document as EditorBlock[]),
    );
    if (expected !== visible) {
      throw new Error("la projection visible ne correspond plus à l’état de page");
    }
    return;
  }

  const expectedByBlock = new Map<string, PageTransactionResult["semanticChanges"][number]>();
  for (const change of input.result.semanticChanges) expectedByBlock.set(change.blockId, change);
  for (const [blockId, change] of expectedByBlock) {
    if (change.type === "block-deleted") {
      if (input.editor.getBlock(blockId) !== undefined) {
        throw new Error(`le bloc supprimé ${blockId} est encore visible`);
      }
      continue;
    }
    const visibleBlock = input.editor.getBlock(blockId) as EditorBlock | undefined;
    if (visibleBlock === undefined) throw new Error(`le bloc ${blockId} n’est plus visible`);
    const expected = canonicalDocumentJsonV3({ blocks: [change.blockAfter] });
    const visible = canonicalDocumentJsonV3({
      blocks: [blockNoteBlockToCanonical(visibleBlock)],
    });
    if (expected !== visible) {
      throw new Error(`le bloc visible ${blockId} ne correspond plus à l’état de page`);
    }
  }
}

export interface PageEditorHandle {
  read(): BlockDocument;
  focus(target?: { readonly blockId: Uuid; readonly placement: "start" | "end" }): void;
}

export function PageEditor({
  pageId,
  document,
  editable,
  handleRef,
  items,
  onOpenPage,
}: {
  readonly pageId: Uuid;
  readonly document: BlockDocument;
  readonly editable: boolean;
  readonly handleRef: React.RefObject<PageEditorHandle | null>;
  readonly items: readonly ProjectedItem[];
  readonly onOpenPage?: ((itemId: string) => void) | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const [editorError, setEditorError] = useState<string | null>(null);
  const [, setHistoryVersion] = useState(0);
  const onOpenPageRef = useRef(onOpenPage);
  onOpenPageRef.current = onOpenPage;

  // EditorSurface is keyed by page and opened revision. Keeping these objects
  // for that whole mount prevents a harmless parent render from resetting a
  // local operational history that has not yet reached the legacy save bridge.
  const [operational] = useState(() =>
    OperationalPageDocument.create({
      pageId,
      document: ensureEditableDocument(migrateDocumentV2ToV3(document)),
    }),
  );
  const [history] = useState(() => new PageUndoManager(operational));
  const initialContent = useMemo(
    () => canonicalDocumentToBlockNote(operational.snapshot()),
    [operational],
  );
  const editor = useCreateBlockNote(
    {
      schema: blockNoteSchema as unknown as ReturnType<typeof CommunityBlockNoteSchema.create>,
      initialContent: initialContent as unknown as PartialBlock[],
      dictionary: fr,
      animations: false,
      defaultStyles: false,
      setIdAttribute: true,
      tabBehavior: "prefer-indent",
      links: {
        isValidLink: (href) =>
          href.startsWith(PAGE_LINK_PREFIX) || /^(?:https?|mailto):/u.test(href),
        onClick: (event) => {
          const href = (event.target as HTMLElement | null)?.closest("a")?.getAttribute("href");
          if (href?.startsWith(PAGE_LINK_PREFIX)) {
            event.preventDefault();
            onOpenPageRef.current?.(href.slice(PAGE_LINK_PREFIX.length));
          }
        },
      },
      domAttributes: {
        editor: {
          class: "editor-surface",
          role: "textbox",
          "aria-label": "Contenu de la page",
          "aria-multiline": "true",
        },
      },
    },
    [operational],
  ) as unknown as EditorInstance;
  const origin = useMemo(() => new EditorOriginGuard(), []);
  const viewEditor = editor as unknown as ComponentProps<typeof BlockNoteView>["editor"];

  const recoverVisibleProjection = useCallback(() => {
    let activeBlockId: string | null = null;
    try {
      activeBlockId = editor.getTextCursorPosition().block.id;
    } catch {
      activeBlockId = null;
    }
    origin.run("recovery", () => {
      editor.replaceBlocks(
        editor.document,
        canonicalDocumentToBlockNote(operational.snapshot()) as unknown as PartialBlock[],
      );
    });
    const fallbackId =
      activeBlockId !== null && editor.getBlock(activeBlockId) !== undefined
        ? activeBlockId
        : editor.document[0]?.id;
    if (fallbackId !== undefined) editor.setTextCursorPosition(fallbackId, "end");
  }, [editor, operational, origin]);

  const applyLocalChanges = useCallback(
    (changes: EditorBlocksChanged) => {
      if (!origin.acceptLocalChanges || changes.length === 0) return;
      try {
        const commands = commandsFromBlockNoteChanges({
          changes,
          document: editor.document as EditorBlock[],
        });
        if (commands.length === 0) return;
        const dropRefusal = validateBlockDrop(changes, editor.document as EditorBlock[]);
        if (dropRefusal !== null) throw new Error(dropRefusal);
        const result = history.execute(commands);
        setHistoryVersion((version) => version + 1);
        assertVisibleProjection({ editor, operational, commands, result });
        setEditorError(null);
      } catch (error) {
        recoverVisibleProjection();
        setEditorError(
          error instanceof Error
            ? `Cette modification n’a pas été appliquée : ${error.message}`
            : "Cette modification n’a pas été appliquée.",
        );
      }
    },
    [editor, history, operational, origin, recoverVisibleProjection],
  );
  const batcher = useMemo(() => new EditorChangeBatcher(applyLocalChanges), [applyLocalChanges]);

  useEffect(
    () =>
      editor.onChange((_changedEditor, { getChanges }) => {
        batcher.push(getChanges() as unknown as EditorBlocksChanged);
      }),
    [batcher, editor],
  );

  useEffect(() => {
    editor.isEditable = editable;
  }, [editable, editor]);

  const applyHistory = useCallback(
    (direction: "undo" | "redo") => {
      try {
        const result = direction === "undo" ? history.undo() : history.redo();
        if (result === null) return;
        recoverVisibleProjection();
        setHistoryVersion((version) => version + 1);
        setEditorError(null);
      } catch (error) {
        setEditorError(
          error instanceof Error
            ? `Impossible de ${direction === "undo" ? "revenir en arrière" : "rétablir"} : ${error.message}`
            : "L’historique local n’a pas pu être appliqué.",
        );
      }
    },
    [history, recoverVisibleProjection],
  );
  const undo = useCallback(() => applyHistory("undo"), [applyHistory]);
  const redo = useCallback(() => applyHistory("redo"), [applyHistory]);
  const reportEditorError = useCallback((message: string) => setEditorError(message), []);
  const shortcuts = useEditorShortcuts({
    editor,
    editable,
    undo,
    redo,
    reportError: reportEditorError,
  });

  useImperativeHandle(
    handleRef,
    () => ({
      read: () => canonicalV3ToLegacyV2(operational.snapshot()),
      focus: (target) => {
        const fallback = editor.document[0];
        const blockId = target?.blockId ?? (fallback?.id as Uuid | undefined);
        if (blockId !== undefined) {
          editor.setTextCursorPosition(blockId, target?.placement ?? "start");
        }
      },
    }),
    [editor, operational],
  );

  return (
    <section
      className="page-editor"
      data-testid="block-editor"
      aria-label="Éditeur de page"
      onCompositionStart={() => batcher.beginComposition()}
      onCompositionEnd={() => batcher.endComposition()}
      onKeyDownCapture={shortcuts.onKeyDown}
      onContextMenu={shortcuts.onContextMenu}
      onBeforeInputCapture={(event) => {
        if (!editable) return;
        const action = historyActionFromInputType((event.nativeEvent as InputEvent).inputType);
        if (action === null) return;
        event.preventDefault();
        if (action === "undo") undo();
        else redo();
      }}
    >
      <div className="editor-history-controls" role="toolbar" aria-label="Historique local">
        <Button
          type="button"
          size="square"
          variant="ghost"
          data-testid="undo"
          aria-label="Annuler"
          title="Annuler (⌘Z)"
          disabled={!editable || !history.canUndo}
          onClick={undo}
        >
          <AppIcon name="undo" />
        </Button>
        <Button
          type="button"
          size="square"
          variant="ghost"
          data-testid="redo"
          aria-label="Rétablir"
          title="Rétablir (⇧⌘Z)"
          disabled={!editable || !history.canRedo}
          onClick={redo}
        >
          <AppIcon name="redo" />
        </Button>
      </div>
      <BlockNoteView
        editor={viewEditor}
        editable={editable}
        theme={resolvedTheme}
        slashMenu={false}
        sideMenu={false}
        formattingToolbar={false}
        filePanel={false}
        tableHandles={false}
        emojiPicker={false}
      >
        <FrenchSlashMenu />
        <BlockSideMenu onError={reportEditorError} />
        <EditorFormattingToolbar currentItemId={pageId} items={items} />
      </BlockNoteView>
      <BlockContextMenu
        editor={editor}
        state={shortcuts.contextMenu}
        onDismiss={shortcuts.dismissContextMenu}
        onError={reportEditorError}
      />
      {editorError === null ? null : (
        <p className="status-banner" data-state="error" role="alert" data-testid="editor-error">
          {editorError}
        </p>
      )}
    </section>
  );
}
