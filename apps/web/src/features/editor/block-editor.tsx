import {
  type EditorDocument,
  isUuid,
  type Uuid,
  validateEditorDocument,
} from "@myownnotion/domain";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createEditorExtensions } from "./editor-extensions.ts";
import { EditorHelp } from "./editor-help.tsx";
import { EditorSaveStatus } from "./editor-save-status.tsx";
import { EditorToolbar } from "./editor-toolbar.tsx";
import { SaveCoordinator, type SaveCoordinatorState } from "./save-coordinator.ts";
import { TaskDetails } from "./task-details.tsx";
import { upgradeEditorTaskItems } from "./task-item.ts";
import type { WikiLinkCandidate } from "./wiki-link.ts";

export function BlockEditor({
  initialDocument,
  saveState,
  onSave,
  onSaveStateChange,
  sourceItemId,
  wikiLinkCandidates,
  onNavigateWikiLink,
  focusTaskId = null,
}: {
  readonly initialDocument: EditorDocument;
  readonly saveState: SaveCoordinatorState;
  readonly onSave: (document: EditorDocument) => Promise<void>;
  readonly onSaveStateChange: (state: SaveCoordinatorState) => void;
  readonly sourceItemId: Uuid;
  readonly wikiLinkCandidates: readonly WikiLinkCandidate[];
  readonly onNavigateWikiLink: (targetItemId: Uuid) => void;
  readonly focusTaskId?: Uuid | null;
}) {
  const [transactionVersion, setTransactionVersion] = useState(0);
  const [clientError, setClientError] = useState<string | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onSaveStateChangeRef = useRef(onSaveStateChange);
  onSaveStateChangeRef.current = onSaveStateChange;
  const wikiLinkCandidatesRef = useRef(wikiLinkCandidates);
  wikiLinkCandidatesRef.current = wikiLinkCandidates;
  const onNavigateWikiLinkRef = useRef(onNavigateWikiLink);
  onNavigateWikiLinkRef.current = onNavigateWikiLink;
  const coordinatorRef = useRef<SaveCoordinator<EditorDocument> | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = new SaveCoordinator({
      delayMs: 300,
      save: (document) => onSaveRef.current(document),
      onStateChange: (state) => onSaveStateChangeRef.current?.(state),
    });
  }
  const coordinator = coordinatorRef.current;
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current) {
          void coordinator.dispose();
        }
      });
    };
  }, [coordinator]);

  const editor = useEditor({
    extensions: createEditorExtensions({
      sourceItemId,
      getWikiLinkCandidates: () => wikiLinkCandidatesRef.current,
      onNavigateWikiLink: (targetItemId) => onNavigateWikiLinkRef.current(targetItemId),
    }),
    content: structuredClone(initialDocument) as unknown as JSONContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Page content",
        "aria-multiline": "true",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      setClientError(null);
      const validated = validateEditorDocument(updatedEditor.getJSON(), {
        taskMetadata: "current",
      });
      if (!validated.ok) {
        setClientError(`${validated.error.code}: ${validated.error.title}`);
        return;
      }
      coordinator.schedule(validated.value);
      updatedEditor.commands.scrollIntoView();
    },
    onTransaction: () => setTransactionVersion((version) => version + 1),
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      setTransactionVersion((version) => version + 1);
      updatedEditor.commands.scrollIntoView();
    },
  });

  useEffect(() => {
    if (editor === null || focusTaskId === null) {
      return;
    }
    let taskPosition: number | null = null;
    editor.state.doc.descendants((node, position) => {
      if (
        taskPosition === null &&
        node.type.name === "taskItem" &&
        node.attrs["taskId"] === focusTaskId
      ) {
        taskPosition = position;
      }
    });
    if (taskPosition === null) {
      return;
    }
    editor.commands.focus(taskPosition + 1);
    const escaped = typeof CSS === "undefined" ? focusTaskId : CSS.escape(focusTaskId);
    editor.view.dom
      .querySelector<HTMLElement>(`[data-task-id="${escaped}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [editor, focusTaskId]);

  if (editor === null) {
    return <p role="status">Loading editor…</p>;
  }

  const saveNow = async () => {
    upgradeEditorTaskItems(editor);
    const validated = validateEditorDocument(editor.getJSON(), { taskMetadata: "current" });
    if (!validated.ok) {
      setClientError(`${validated.error.code}: ${validated.error.title}`);
      return;
    }
    coordinator.schedule(validated.value);
    await coordinator.flush();
  };

  const handleWikiLinkClick = (event: React.MouseEvent<HTMLElement>) => {
    const element =
      event.target instanceof Element ? event.target.closest("a[data-wiki-link]") : null;
    const targetItemId = element?.getAttribute("data-target-item-id");
    if (!isUuid(targetItemId)) {
      return;
    }
    event.preventDefault();
    onNavigateWikiLinkRef.current(targetItemId);
  };

  return (
    <div className="block-editor" data-testid="block-editor">
      <EditorToolbar editor={editor} />
      <EditorHelp />
      <TaskDetails editor={editor} transactionVersion={transactionVersion} />
      <EditorContent editor={editor} className="editor-content" onClick={handleWikiLinkClick} />
      <div className="editor-footer">
        <button
          type="button"
          aria-label="Save page"
          disabled={saveState.status === "saving-local"}
          onClick={() => void saveNow()}
        >
          {saveState.status === "saving-local" ? "Saving locally…" : "Save now"}
        </button>
        <EditorSaveStatus state={saveState} />
        {clientError !== null ? (
          <span className="status-banner" data-state="error" role="alert">
            {clientError}
          </span>
        ) : null}
      </div>
    </div>
  );
}
