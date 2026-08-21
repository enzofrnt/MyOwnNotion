import { BlockNoteView } from "@blocknote/ariakit";
import type { ProjectedItem } from "@myownnotion/client-core";
import type { BlockDocument, BlockDocumentV3, Uuid } from "@myownnotion/domain";
import { canonicalDocumentJsonV3 } from "@myownnotion/domain";
import type { PageCommand } from "@myownnotion/page-state";
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
  blockNoteDocumentToCanonical,
  canonicalDocumentToBlockNote,
  canonicalV3ToLegacyV2,
} from "./blocknote-conversion.ts";
import {
  blockNoteSchema,
  type EditorBlock,
  type EditorBlocksChanged,
  type EditorInstance,
} from "./blocknote-schema.ts";
import { commandsFromBlockNoteChanges, EditorChangeBatcher } from "./editor-adapter.ts";
import {
  createMemoryEditorEngine,
  createSessionEditorEngine,
  type EditorEngine,
} from "./editor-engine.ts";
import { BlockContextMenu } from "./editor-menus/block-context-menu.tsx";
import { BlockSideMenu } from "./editor-menus/block-side-menu.tsx";
import { EditorFormattingToolbar } from "./editor-menus/formatting-toolbar.tsx";
import { FrenchSlashMenu } from "./editor-menus/slash-menu.tsx";
import { applyRemoteEditorProjection, EditorOriginGuard } from "./editor-remote-apply.ts";
import { historyActionFromInputType, useEditorShortcuts } from "./editor-shortcuts.ts";

const PAGE_LINK_PREFIX = "myownnotion:page:";

function canonicalJsonOfEditor(blocks: readonly EditorBlock[]): string {
  return canonicalDocumentJsonV3(blockNoteDocumentToCanonical(blocks));
}

function canonicalJsonOfDocument(document: BlockDocumentV3): string {
  return canonicalDocumentJsonV3(document);
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
  session,
}: {
  readonly pageId: Uuid;
  readonly document: BlockDocument;
  readonly editable: boolean;
  readonly handleRef: React.RefObject<PageEditorHandle | null>;
  readonly items: readonly ProjectedItem[];
  readonly onOpenPage?: ((itemId: string) => void) | undefined;
  /** Present when the page is backed by a durable editing session (FR-052). */
  readonly session?: import("./editor-sync-status.tsx").EditorDurableSession | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const [editorError, setEditorError] = useState<string | null>(null);
  const [, setHistoryVersion] = useState(0);
  const onOpenPageRef = useRef(onOpenPage);
  onOpenPageRef.current = onOpenPage;

  // One engine per mounted surface. Keeping it for that whole mount prevents a
  // harmless parent render from resetting an operational history — in memory
  // or in the durable session — that the visible typing depends on.
  const [engine] = useState<EditorEngine>(() =>
    session === undefined
      ? createMemoryEditorEngine(pageId, document)
      : createSessionEditorEngine(session),
  );
  const initialContent = useMemo(() => canonicalDocumentToBlockNote(engine.snapshot()), [engine]);
  const editor = useCreateBlockNote(
    {
      schema: blockNoteSchema as unknown as ReturnType<typeof CommunityBlockNoteSchema.create>,
      // BlockNote refuses an empty array; its own default paragraph stands in
      // until a real block exists. Sessions seed one before mounting, so this
      // is a belt-and-braces guard, not the normal path.
      ...(initialContent.length === 0
        ? {}
        : { initialContent: initialContent as unknown as PartialBlock[] }),
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
    [engine],
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
        canonicalDocumentToBlockNote(engine.snapshot()) as unknown as PartialBlock[],
      );
    });
    const fallbackId =
      activeBlockId !== null && editor.getBlock(activeBlockId) !== undefined
        ? activeBlockId
        : editor.document[0]?.id;
    if (fallbackId !== undefined) editor.setTextCursorPosition(fallbackId, "end");
  }, [editor, engine, origin]);

  // Gestures arrive faster than durable commits resolve. The visible surface
  // may therefore be several transactions ahead of the last completed one, so
  // a per-gesture projection assertion would compare unrelated states. The
  // guard instead runs when the pipeline drains: with nothing in flight, the
  // visible document and the authority must agree exactly.
  const inFlight = useRef(0);
  const assertDrainedProjection = useCallback(() => {
    if (inFlight.current > 0) return;
    if (
      canonicalJsonOfEditor(editor.document as EditorBlock[]) !==
      canonicalJsonOfDocument(engine.snapshot())
    ) {
      throw new Error("la projection visible ne correspond plus à l’état de page");
    }
  }, [editor, engine]);

  const applyLocalChanges = useCallback(
    (changes: EditorBlocksChanged) => {
      if (!origin.acceptLocalChanges || changes.length === 0) return;
      let commands: readonly PageCommand[] = [];
      try {
        commands = commandsFromBlockNoteChanges({
          changes,
          document: editor.document as EditorBlock[],
          tableIdForInternalBlock: (blockId) => engine.canonicalBlockIdForIdentity(blockId),
        });
        if (commands.length === 0) return;
        const dropRefusal = validateBlockDrop(changes, editor.document as EditorBlock[]);
        if (dropRefusal !== null) throw new Error(dropRefusal);
      } catch (error) {
        recoverVisibleProjection();
        setEditorError(
          error instanceof Error
            ? `Cette modification n’a pas été appliquée : ${error.message}`
            : "Cette modification n’a pas été appliquée.",
        );
        return;
      }
      // The gesture is already visible; the engine makes it authoritative.
      // A blocked session keeps what the owner typed on screen and reports
      // through its own state — only an execution refusal rewinds the view.
      inFlight.current += 1;
      setHistoryVersion((version) => version + 1);
      void engine
        .apply(commands)
        .then(() => {
          inFlight.current -= 1;
          try {
            assertDrainedProjection();
            setEditorError(null);
          } catch (error) {
            recoverVisibleProjection();
            setEditorError(
              error instanceof Error
                ? `Cette modification n’a pas été appliquée : ${error.message}`
                : "Cette modification n’a pas été appliquée.",
            );
          }
        })
        .catch((error: unknown) => {
          inFlight.current -= 1;
          if (
            session !== undefined &&
            (session.sync.synchronizationKind === "blocked" || session.recoveryBuffer !== null)
          ) {
            return;
          }
          recoverVisibleProjection();
          setEditorError(
            error instanceof Error
              ? `Cette modification n’a pas été appliquée : ${error.message}`
              : "Cette modification n’a pas été appliquée.",
          );
        });
    },
    [assertDrainedProjection, editor, engine, origin, recoverVisibleProjection, session],
  );
  const batcher = useMemo(() => new EditorChangeBatcher(applyLocalChanges), [applyLocalChanges]);

  useEffect(
    () =>
      editor.onChange((_changedEditor, { getChanges }) => {
        batcher.push(getChanges() as unknown as EditorBlocksChanged);
      }),
    [batcher, editor],
  );

  // The session is also fed from outside this component: remote merges adopted
  // by the reconciler arrive as change events and must reach the visible
  // surface by identity — never as a full replacement of the local draft.
  useEffect(() => {
    if (session === undefined) return;
    return session.subscribe(
      (change: {
        readonly origin: string;
        readonly document: Parameters<Parameters<typeof session.subscribe>[0]>[0]["document"];
      }) => {
        setHistoryVersion((version) => version + 1);
        if (change.origin === "remote") {
          applyRemoteEditorProjection({
            editor,
            origin,
            next: canonicalDocumentToBlockNote(change.document) as EditorBlock[],
          });
        }
      },
    );
  }, [editor, origin, session]);

  useEffect(() => {
    editor.isEditable = editable;
  }, [editable, editor]);

  const applyHistory = useCallback(
    (direction: "undo" | "redo") => {
      const apply = direction === "undo" ? engine.undo() : engine.redo();
      void apply
        .then((result) => {
          if (!result.changed) return;
          recoverVisibleProjection();
          setHistoryVersion((version) => version + 1);
          setEditorError(null);
        })
        .catch((error: unknown) => {
          if (
            session !== undefined &&
            (session.sync.synchronizationKind === "blocked" || session.recoveryBuffer !== null)
          ) {
            return;
          }
          setEditorError(
            error instanceof Error
              ? `Impossible de ${direction === "undo" ? "revenir en arrière" : "rétablir"} : ${error.message}`
              : "L’historique local n’a pas pu être appliqué.",
          );
        });
    },
    [engine, recoverVisibleProjection, session],
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
      read: () => canonicalV3ToLegacyV2(engine.snapshot()),
      focus: (target) => {
        const fallback = editor.document[0];
        const blockId = target?.blockId ?? (fallback?.id as Uuid | undefined);
        if (blockId !== undefined) {
          editor.setTextCursorPosition(blockId, target?.placement ?? "start");
        }
      },
    }),
    [editor, engine],
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
          disabled={!editable || !engine.canUndo}
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
          disabled={!editable || !engine.canRedo}
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
