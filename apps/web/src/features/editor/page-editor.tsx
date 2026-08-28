import { BlockNoteView } from "@blocknote/ariakit";
import type { ProjectedItem } from "@myownnotion/client-core";
import type { BlockDocument, Uuid } from "@myownnotion/domain";
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
import { FR_COPY } from "../../ui/copy/fr.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { AsyncState } from "../../ui/primitives/async-state.tsx";
import { Button } from "../../ui/primitives/button.tsx";
import { useTheme } from "../../ui/theme-provider.tsx";
import { validateBlockDrop } from "./block-drag-drop.ts";
import { canonicalDocumentToBlockNote, canonicalV3ToLegacyV2 } from "./blocknote-conversion.ts";
import {
  blockNoteSchema,
  type EditorBlock,
  type EditorBlocksChanged,
  type EditorInstance,
} from "./blocknote-schema.ts";
import {
  commandsFromBlockNoteChanges,
  EditorChangeBatcher,
  rebaseBlockNoteChanges,
} from "./editor-adapter.ts";
import {
  createMemoryEditorEngine,
  createSessionEditorEngine,
  type EditorEngine,
} from "./editor-engine.ts";
import { editorFileTransferQueue } from "./editor-file-state.tsx";
import { insertDroppedFiles } from "./editor-files.ts";
import {
  clearStaleLinkTypingState,
  type EditorLinkCreation,
  editorLinkCreationFromSelection,
} from "./editor-links.ts";
import { BlockContextMenu } from "./editor-menus/block-context-menu.tsx";
import { BlockSideMenu } from "./editor-menus/block-side-menu.tsx";
import { EditorFormattingToolbar } from "./editor-menus/formatting-toolbar.tsx";
import { PageLinkPicker, type PageLinkPickerRequest } from "./editor-menus/page-link-picker.tsx";
import { type CreateSubpage, FrenchSlashMenu } from "./editor-menus/slash-menu.tsx";
import {
  WebBookmarkDialog,
  type WebBookmarkEditor,
  type WebBookmarkRequest,
} from "./editor-menus/web-bookmark-dialog.tsx";
import {
  applyRemoteEditorProjection,
  type EditorChangeOrigin,
  EditorOriginGuard,
} from "./editor-remote-apply.ts";
import { historyActionFromInputType, useEditorShortcuts } from "./editor-shortcuts.ts";
import { pageLinkTargetFromHref } from "./page-link-href.ts";
import { updatePageLinkPresentations } from "./page-link-inline-content.ts";

const EDITOR_PROJECTION_QUIET_MS = 120;

interface LocalInputBurstSession {
  beginLocalInputBurst(): void;
  endLocalInputBurst(): Promise<void>;
}

function supportsLocalInputBursts(value: unknown): value is LocalInputBurstSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "beginLocalInputBurst" in value &&
    typeof value.beginLocalInputBurst === "function" &&
    "endLocalInputBurst" in value &&
    typeof value.endLocalInputBurst === "function"
  );
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
  onCreateSubpage,
  onOpenPage,
  onSettlementChange,
  session,
}: {
  readonly pageId: Uuid;
  readonly document: BlockDocument;
  readonly editable: boolean;
  readonly handleRef: React.RefObject<PageEditorHandle | null>;
  readonly items: readonly ProjectedItem[];
  readonly onCreateSubpage?: CreateSubpage | undefined;
  readonly onOpenPage?: ((itemId: string) => void) | undefined;
  /** Reports whether every browser gesture has crossed the durable engine boundary. */
  readonly onSettlementChange?: ((settled: boolean) => void) | undefined;
  /** Present when the page is backed by a durable editing session (FR-052). */
  readonly session?: import("./editor-sync-status.tsx").EditorDurableSession | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const [editorError, setEditorError] = useState<string | null>(null);
  const [pageLinkPicker, setPageLinkPicker] = useState<PageLinkPickerRequest | null>(null);
  const [webBookmarkDialog, setWebBookmarkDialog] = useState<WebBookmarkRequest | null>(null);
  const [, setHistoryVersion] = useState(0);
  const onOpenPageRef = useRef(onOpenPage);
  const editorHostRef = useRef<HTMLElement | null>(null);
  // BlockNote can replace the floating toolbar after a formatting action.
  // This ref belongs to the editor surface so the replacement cannot discard
  // the range needed by the next page-link action.
  const preservedPageLinkSelection = useRef<EditorLinkCreation | null>(null);
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
          pageLinkTargetFromHref(href) !== null || /^(?:https?|mailto):/u.test(href),
        onClick: (event) => {
          const href = (event.target as HTMLElement | null)?.closest("a")?.getAttribute("href");
          const targetItemId = pageLinkTargetFromHref(href);
          if (targetItemId !== null) {
            event.preventDefault();
            onOpenPageRef.current?.(targetItemId);
          }
        },
      },
      domAttributes: {
        editor: {
          class: "editor-surface",
          role: "textbox",
          "aria-label": FR_COPY.editor.surface.contentLabel,
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

  // Gestures arrive faster than durable commits resolve, and BlockNote may
  // publish the last browser input one task after its DOM is already visible.
  // A temporary empty pipeline is therefore not a save boundary. Settlement
  // requires a quiet window with no newer browser activity and no commit in
  // flight. Canonical projection validity is proved by the atomic commit; a
  // visual BlockNote round-trip is not an authority check because opaque
  // blocks intentionally have a lossy placeholder representation.
  const inFlight = useRef(0);
  // Remote projection work and browser input may overlap in the same quiet
  // window. Keep the local witness independent: a remote import must neither
  // impersonate a browser gesture nor prevent the first local gesture from
  // advancing the sequence used by durability assertions.
  const editorActivitySequence = useRef(0);
  const localActivityInCurrentBurst = useRef(false);
  const editorLocalChangeCount = useRef(0);
  const editorSuppressedChangeCount = useRef(0);
  const editorApplyCount = useRef(0);
  const editorApplyFailureCount = useRef(0);
  const lastEditorApplyErrorType = useRef<string | null>(null);
  const recentFileGesture = useRef<{ fingerprint: string; acceptedAt: number } | null>(null);
  const lastEditorActivityAt = useRef(0);
  const editorSettled = useRef(true);
  const remoteProjectionPending = useRef(false);
  const localBurstDrainInFlight = useRef(false);
  const projectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleProjectionSettlementRef = useRef<() => void>(() => undefined);

  const writeEditorSettlementState = useCallback(() => {
    const host = editorHostRef.current;
    if (host === null) return;
    host.setAttribute("data-editor-change-sequence", String(editorActivitySequence.current));
    host.setAttribute("data-editor-settled", editorSettled.current ? "true" : "false");
    host.setAttribute("data-editor-local-change-count", String(editorLocalChangeCount.current));
    host.setAttribute(
      "data-editor-suppressed-change-count",
      String(editorSuppressedChangeCount.current),
    );
    host.setAttribute("data-editor-apply-count", String(editorApplyCount.current));
    host.setAttribute("data-editor-apply-failures", String(editorApplyFailureCount.current));
    if (lastEditorApplyErrorType.current === null) {
      host.removeAttribute("data-editor-apply-error");
    } else {
      host.setAttribute("data-editor-apply-error", lastEditorApplyErrorType.current);
    }
  }, []);

  const markEditorActivity = useCallback(
    (activity: "local" | "remote" = "local") => {
      const beginsBusyWindow = editorSettled.current;
      const beginsLocalBurst = activity === "local" && !localActivityInCurrentBurst.current;
      if (beginsLocalBurst) {
        editorActivitySequence.current += 1;
        localActivityInCurrentBurst.current = true;
        if (supportsLocalInputBursts(session)) session.beginLocalInputBurst();
      }
      lastEditorActivityAt.current = Date.now();
      editorSettled.current = false;
      if (beginsBusyWindow || beginsLocalBurst) {
        writeEditorSettlementState();
      }
      if (beginsBusyWindow) {
        onSettlementChange?.(false);
      }
    },
    [onSettlementChange, session, writeEditorSettlementState],
  );

  const markEditorSettled = useCallback(() => {
    if (inFlight.current > 0 || localBurstDrainInFlight.current) return;
    const endedLocalBurst = localActivityInCurrentBurst.current;
    localActivityInCurrentBurst.current = false;
    if (endedLocalBurst && supportsLocalInputBursts(session)) {
      // `endLocalInputBurst` may adopt durable operations and synchronously
      // emit a remote session event before its promise resolves. Publishing a
      // settled surface before that adoption and its visual projection finish
      // leaves a narrow but destructive interaction window: a toolbar or
      // context-menu gesture can target the pre-adoption tree while BlockNote
      // is replacing it. Keep the surface busy and let a new quiet pass apply
      // the resulting projection before acknowledging settlement.
      localBurstDrainInFlight.current = true;
      void session
        .endLocalInputBurst()
        .catch((error: unknown) => {
          setEditorError(
            error instanceof Error
              ? FR_COPY.editor.errors.remoteUpdateFailedWithDetail(error.message)
              : FR_COPY.editor.errors.remoteUpdateFailed,
          );
        })
        .finally(() => {
          localBurstDrainInFlight.current = false;
          scheduleProjectionSettlementRef.current();
        });
      return;
    }
    editorSettled.current = true;
    writeEditorSettlementState();
    onSettlementChange?.(true);
    // Undo/redo availability is presentation state. Updating it once per
    // settled burst avoids re-rendering a 500-block surface for every key.
    setHistoryVersion((version) => version + 1);
  }, [onSettlementChange, session, writeEditorSettlementState]);

  const applyPendingRemoteProjection = useCallback(() => {
    if (!remoteProjectionPending.current) return;
    remoteProjectionPending.current = false;
    // A remote notification can arrive between the browser painting a key and
    // BlockNote publishing its change. Applying the event's captured document
    // at that instant rewinds the visible key and can move the selection. Wait
    // for the local queue to drain, then project the engine's *current*
    // authority, which includes every local commit and every adopted remote
    // update that arrived in the meantime.
    applyRemoteEditorProjection({
      editor,
      origin,
      next: canonicalDocumentToBlockNote(engine.snapshot()) as EditorBlock[],
    });
  }, [editor, engine, origin]);

  const scheduleProjectionSettlement = useCallback(() => {
    if (projectionTimer.current !== null) return;
    const inspect = (): void => {
      const remainingQuietTime =
        EDITOR_PROJECTION_QUIET_MS - (Date.now() - lastEditorActivityAt.current);
      if (remainingQuietTime > 0) {
        projectionTimer.current = setTimeout(inspect, remainingQuietTime);
        return;
      }
      if (inFlight.current > 0) {
        // A cold IndexedDB transaction can outlive the quiet window. Keep one
        // bounded check alive; the completion callback does not need to race
        // the timer to make progress.
        projectionTimer.current = setTimeout(inspect, EDITOR_PROJECTION_QUIET_MS);
        return;
      }
      if (localBurstDrainInFlight.current) {
        projectionTimer.current = setTimeout(inspect, EDITOR_PROJECTION_QUIET_MS);
        return;
      }
      projectionTimer.current = null;
      applyPendingRemoteProjection();
      setEditorError(null);
      markEditorSettled();
    };
    projectionTimer.current = setTimeout(inspect, EDITOR_PROJECTION_QUIET_MS);
  }, [applyPendingRemoteProjection, markEditorSettled]);
  scheduleProjectionSettlementRef.current = scheduleProjectionSettlement;

  useEffect(
    () => () => {
      if (projectionTimer.current !== null) clearTimeout(projectionTimer.current);
    },
    [],
  );

  const applyLocalChanges = useCallback(
    async (
      changes: EditorBlocksChanged,
      document: readonly EditorBlock[],
      publishedOrigin: EditorChangeOrigin,
    ): Promise<void> => {
      if (changes.length === 0) return;
      editorLocalChangeCount.current += 1;
      // The origin must be the one captured synchronously by BlockNote's
      // onChange callback. A remote projection can be queued behind a slow
      // local IndexedDB commit; consulting the mutable guard here would then
      // see `local` again and durably translate the remote echo as an owner
      // deletion.
      if (publishedOrigin !== "local") {
        editorSuppressedChangeCount.current += 1;
        writeEditorSettlementState();
        return;
      }
      markEditorActivity();
      let commands: readonly PageCommand[] = [];
      try {
        const authoritativeDocument = canonicalDocumentToBlockNote(
          engine.snapshot(),
        ) as EditorBlock[];
        commands = commandsFromBlockNoteChanges({
          // A pending remote projection means the operational authority has
          // advanced beyond the still-visible BlockNote baseline. Rebasing
          // against that newer authority would interpret absent remote text
          // as an owner deletion. The reported before-state remains the safe
          // coordinate system until the projection reaches the surface.
          changes: remoteProjectionPending.current
            ? changes
            : rebaseBlockNoteChanges(changes, authoritativeDocument),
          document,
          tableIdForInternalBlock: (blockId) => engine.canonicalBlockIdForIdentity(blockId),
        });
        if (commands.length === 0) {
          scheduleProjectionSettlement();
          return;
        }
        const dropRefusal = validateBlockDrop(changes, document);
        if (dropRefusal !== null) throw new Error(dropRefusal);
      } catch (error) {
        recoverVisibleProjection();
        setEditorError(
          error instanceof Error
            ? FR_COPY.editor.errors.notAppliedWithDetail(error.message)
            : FR_COPY.editor.errors.notApplied,
        );
        scheduleProjectionSettlement();
        return;
      }
      // The gesture is already visible; the engine makes it authoritative.
      // A blocked session keeps what the owner typed on screen and reports
      // through its own state — only an execution refusal rewinds the view.
      editorApplyCount.current += 1;
      writeEditorSettlementState();
      inFlight.current += 1;
      try {
        await engine.apply(commands);
        inFlight.current -= 1;
        scheduleProjectionSettlement();
      } catch (error: unknown) {
        inFlight.current -= 1;
        editorApplyFailureCount.current += 1;
        lastEditorApplyErrorType.current =
          error instanceof Error ? error.name : "UnknownEditorApplyError";
        writeEditorSettlementState();
        if (
          session !== undefined &&
          (session.sync.synchronizationKind === "blocked" || session.recoveryBuffer !== null)
        ) {
          markEditorSettled();
          return;
        }
        recoverVisibleProjection();
        setEditorError(
          error instanceof Error
            ? FR_COPY.editor.errors.notAppliedWithDetail(error.message)
            : FR_COPY.editor.errors.notApplied,
        );
        scheduleProjectionSettlement();
      }
    },
    [
      engine,
      markEditorActivity,
      markEditorSettled,
      recoverVisibleProjection,
      scheduleProjectionSettlement,
      session,
      writeEditorSettlementState,
    ],
  );
  const batcher = useMemo(() => new EditorChangeBatcher(applyLocalChanges), [applyLocalChanges]);
  const openCreatedSubpage = useCallback(
    async (child: { readonly id: string }) => {
      // BlockNote publishes menu changes just after the click handler. Wait for
      // the generated page-link operation to cross the durable engine boundary
      // before unmounting this page to open its new child.
      await batcher.runAfterPendingChanges(() => onOpenPageRef.current?.(child.id));
    },
    [batcher],
  );

  useEffect(
    () =>
      editor.onChange((changedEditor, { getChanges }) => {
        batcher.push(
          getChanges() as unknown as EditorBlocksChanged,
          changedEditor.document as unknown as readonly EditorBlock[],
          origin.origin,
        );
      }),
    [batcher, editor, origin],
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
        if (change.origin === "remote") {
          remoteProjectionPending.current = true;
          markEditorActivity("remote");
          scheduleProjectionSettlement();
        }
      },
    );
  }, [markEditorActivity, scheduleProjectionSettlement, session]);

  useEffect(() => {
    editor.isEditable = editable;
  }, [editable, editor]);

  useEffect(() => {
    updatePageLinkPresentations(editor, items, pageId, onOpenPage);
  }, [editor, items, onOpenPage, pageId]);

  const applyHistory = useCallback(
    (direction: "undo" | "redo") => {
      markEditorActivity();
      inFlight.current += 1;
      void batcher
        .runAfterPendingChanges(() => (direction === "undo" ? engine.undo() : engine.redo()))
        .then((result) => {
          inFlight.current -= 1;
          if (result.changed) recoverVisibleProjection();
          setEditorError(null);
          scheduleProjectionSettlement();
        })
        .catch((error: unknown) => {
          inFlight.current -= 1;
          if (
            session !== undefined &&
            (session.sync.synchronizationKind === "blocked" || session.recoveryBuffer !== null)
          ) {
            markEditorSettled();
            return;
          }
          setEditorError(
            error instanceof Error
              ? FR_COPY.editor.errors.historyActionFailed(direction, error.message)
              : FR_COPY.editor.errors.historyFailed,
          );
          scheduleProjectionSettlement();
        });
    },
    [
      batcher,
      engine,
      markEditorActivity,
      markEditorSettled,
      recoverVisibleProjection,
      scheduleProjectionSettlement,
      session,
    ],
  );
  const undo = useCallback(() => applyHistory("undo"), [applyHistory]);
  const redo = useCallback(() => applyHistory("redo"), [applyHistory]);
  const reportEditorError = useCallback((message: string) => setEditorError(message), []);

  // Dropped or pasted bytes are encrypted durably before the block commit.
  // The transfer becomes runnable only after that commit succeeds, so neither
  // quota nor a process interruption can leave an orphan editor reference.
  const fileQueue = useMemo(editorFileTransferQueue, []);
  const acceptFiles = useCallback(
    (files: readonly File[]) => {
      if (!editable || files.length === 0) return;
      const fingerprint = files
        .map((file) => `${file.name}\u0000${file.size}\u0000${file.type}\u0000${file.lastModified}`)
        .join("\u0001");
      const acceptedAt = performance.now();
      const previous = recentFileGesture.current;
      // Touch engines can re-deliver one native file gesture as a second drop.
      // Deduplicate that delivery window without merging two separate files in
      // the same intentional multi-file gesture.
      if (
        previous !== null &&
        previous.fingerprint === fingerprint &&
        acceptedAt - previous.acceptedAt < 750
      ) {
        return;
      }
      recentFileGesture.current = { fingerprint, acceptedAt };
      let parentId: Uuid | null = null;
      let beforeId: Uuid | null = null;
      try {
        const cursor = editor.getTextCursorPosition().block;
        parentId = null;
        beforeId = cursor.id as Uuid;
      } catch {
        beforeId = null;
      }
      void insertDroppedFiles(
        engine,
        files,
        {
          parentBlockId: parentId,
          beforeBlockId: beforeId,
        },
        fileQueue,
        pageId,
      )
        .then((inserted) => {
          // The insertion went straight to the authority, so the visible
          // surface must be re-projected from it (a plain onChange echo never
          // happened for this gesture).
          if (inserted.length > 0) recoverVisibleProjection();
          void fileQueue.flush();
        })
        .catch((error: unknown) => {
          setEditorError(
            error instanceof Error
              ? FR_COPY.editor.errors.fileInsertionFailedWithDetail(error.message)
              : FR_COPY.editor.errors.fileInsertionFailed,
          );
        });
    },
    [editable, editor, engine, fileQueue, pageId, recoverVisibleProjection],
  );
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
      ref={(element) => {
        editorHostRef.current = element;
        writeEditorSettlementState();
      }}
      className="page-editor"
      data-testid="block-editor"
      aria-label={FR_COPY.editor.surface.label}
      onCompositionStart={() => {
        clearStaleLinkTypingState(editor);
        batcher.beginComposition();
      }}
      onCompositionEnd={() => {
        batcher.endComposition();
        clearStaleLinkTypingState(editor);
      }}
      onKeyDownCapture={(event) => {
        if (
          editable &&
          event.key.length === 1 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          clearStaleLinkTypingState(editor);
        }
        shortcuts.onKeyDown(event);
      }}
      onContextMenu={shortcuts.onContextMenu}
      // Capture before BlockNote sees the native drop. Handling this while the
      // event bubbled let BlockNote insert its own image first on touch-sized
      // WebKit/Chromium surfaces, then our durable path inserted it again.
      onDropCapture={(event) => {
        const files = [...event.dataTransfer.files];
        if (files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        acceptFiles(files);
      }}
      onPasteCapture={(event) => {
        const files = [...event.clipboardData.files];
        if (files.length === 0) {
          clearStaleLinkTypingState(editor);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        acceptFiles(files);
      }}
      onBeforeInputCapture={(event) => {
        if (!editable) return;
        markEditorActivity();
        const nativeInputType = (event.nativeEvent as InputEvent).inputType;
        // WebKit may omit `inputType` on a synthetic beforeinput event even
        // though the DOM type declares it as a string. Missing metadata is an
        // ordinary edit, never a reason to abort the editor event pipeline.
        const inputType = typeof nativeInputType === "string" ? nativeInputType : "";
        if (inputType.startsWith("insert")) clearStaleLinkTypingState(editor);
        if (inputType.startsWith("delete")) {
          // The deletion itself changes the boundary. Clear after BlockNote's
          // handler has applied it so the next key cannot inherit the old mark.
          queueMicrotask(() => clearStaleLinkTypingState(editor));
        }
        const action = historyActionFromInputType(inputType);
        if (action === null) {
          // Most inputs also publish a BlockNote change, which replaces this
          // fallback after its durable commit. Inputs that make no canonical
          // change must still be allowed to settle instead of leaving the
          // surface permanently marked as busy.
          scheduleProjectionSettlement();
          return;
        }
        event.preventDefault();
        if (action === "undo") undo();
        else redo();
      }}
    >
      <div
        className="editor-history-controls"
        role="toolbar"
        aria-label={FR_COPY.editor.surface.historyLabel}
      >
        <Button
          type="button"
          size="square"
          variant="ghost"
          data-testid="undo"
          aria-label={FR_COPY.editor.surface.undo}
          title={FR_COPY.editor.surface.undoTitle}
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
          aria-label={FR_COPY.editor.surface.redo}
          title={FR_COPY.editor.surface.redoTitle}
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
        linkToolbar={false}
        filePanel={false}
        tableHandles={false}
        emojiPicker={false}
      >
        <FrenchSlashMenu
          onCreatePageLink={() => {
            const selection = editorLinkCreationFromSelection(editor);
            if (selection !== null) setPageLinkPicker({ mode: "create", selection });
          }}
          onCreateWebBookmark={(blockId) =>
            setWebBookmarkDialog({ mode: "create", anchorBlockId: blockId })
          }
          onCreateSubpage={onCreateSubpage}
          onSubpageCreated={openCreatedSubpage}
          onError={reportEditorError}
        />
        <BlockSideMenu onError={reportEditorError} />
        <EditorFormattingToolbar
          onPageLinkRequest={setPageLinkPicker}
          preservedSelection={preservedPageLinkSelection}
          onWebBookmarkRequest={() => {
            const anchorBlockId = editor.getTextCursorPosition().block.id;
            setWebBookmarkDialog({ mode: "create", anchorBlockId });
          }}
        />
      </BlockNoteView>
      <BlockContextMenu
        editor={editor}
        state={shortcuts.contextMenu}
        onDismiss={shortcuts.dismissContextMenu}
        onEditPageLink={setPageLinkPicker}
        onEditWebBookmark={setWebBookmarkDialog}
        onError={reportEditorError}
        onOpenPage={onOpenPage}
      />
      <PageLinkPicker
        currentItemId={pageId}
        editor={editor}
        items={items}
        request={pageLinkPicker}
        onClose={() => setPageLinkPicker(null)}
        onError={reportEditorError}
        onOpenPage={onOpenPage}
      />
      <WebBookmarkDialog
        editor={editor as unknown as WebBookmarkEditor}
        request={webBookmarkDialog}
        onClose={() => setWebBookmarkDialog(null)}
      />
      {editorError === null ? null : (
        <AsyncState compact description={editorError} kind="error" testId="editor-error" />
      )}
    </section>
  );
}
