/**
 * The editing surface (T022, T023, T026-T029, US1).
 *
 * Replaces the raw-JSON textarea that stood in for an editor until now. What
 * makes this more than a component swap is what it does *not* do:
 *
 * **It does not own the document format.** Content arrives as a model, is
 * converted for the editor, and is converted back before it is saved. The
 * conversion is the boundary described in `to-tiptap.ts` and `from-tiptap.ts`,
 * and it is the reason a block type this client has never heard of survives
 * being edited on this screen.
 *
 * **It does not rewrite a document it merely opened.** A legacy v1 body is
 * displayed read-only until the owner edits it. The upgrade is their action,
 * not a side effect of navigation.
 *
 * **It does not accept an edit it cannot store safely.** When the device key is
 * unavailable the local projection cannot be sealed, so editing is refused
 * outright rather than degraded to a plaintext write (FR-026).
 */

import type { ProjectedItem } from "@myownnotion/client-core";
import type { BlockDocument, JsonObject, Uuid } from "@myownnotion/domain";
import {
  DOCUMENT_FORMAT,
  DOCUMENT_FORMAT_VERSION,
  emptyDocument,
  normaliseDocument,
  pageLinkTargets,
  readDocumentBody,
  serialiseDocument,
  upgradeLegacyBody,
} from "@myownnotion/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { BlockedNotice } from "../save-state/blocked-notice.tsx";
import { ConflictNotice } from "../save-state/conflict-notice.tsx";
import { SaveStateIndicator } from "../save-state/save-state-indicator.tsx";
import { EditorSurface, type EditorSurfaceHandle } from "./editor-surface.tsx";

/** The stored body, as it was read, for comparing one reading with another. */
function bodyFingerprint(body: unknown): string {
  return JSON.stringify(body ?? null);
}

/**
 * Whether a stored body holds anything an owner would mind losing.
 *
 * The guard below exists to protect work, so it has to know the difference
 * between "someone wrote something here" and "a document row now exists". They
 * are not the same: converting a folder into a page materialises an empty
 * document, and the reconciler then brings that empty document back to this
 * tab — a change to the stored body that destroys nothing and must not block
 * the owner from typing their first words.
 */
function bodyHoldsContent(body: unknown): boolean {
  const read = readDocumentBody(body);
  if (read.kind === "legacy") {
    return Object.keys(read.body).length > 0;
  }
  if (!read.result.ok) {
    // Unreadable is not empty. Refusing to overwrite something this client
    // cannot parse is the cautious answer, and the cautious answer is right
    // when the alternative is destroying it.
    return true;
  }
  return read.result.document.blocks.some(
    (block) => block.type !== "paragraph" || block.content.length > 0,
  );
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly document: BlockDocument }
  /** A version 1 body, shown as it is and not converted until an edit. */
  | { readonly kind: "legacy"; readonly body: JsonObject }
  | { readonly kind: "unavailable"; readonly reason: string };

export function EditorView({
  service,
  itemId,
  itemRevisionId,
  editingAllowed = true,
  items = [],
  onOpenPage,
}: {
  readonly service: LocalContentService;
  readonly itemId: Uuid;
  /** Reload when reconciliation replaces the selected item's projection. */
  readonly itemRevisionId?: Uuid;
  /** False when the device key is unavailable and nothing can be sealed. */
  readonly editingAllowed?: boolean;
  readonly items?: readonly ProjectedItem[];
  readonly onOpenPage?: (itemId: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  // A placeholder for the real save state, which arrives with US2 in the next
  // batch. It says "saved locally" and nothing more, because that is all this
  // component can honestly claim today: the server confirmation it would need
  // to say "saved" is exactly what FR-008 forbids assuming.
  const [savedLocally, setSavedLocally] = useState(false);
  /**
   * The revision this editor was opened on (T047, spec edge case: two tabs).
   *
   * Checked at save time rather than watched, and that is forced by how the
   * store works rather than chosen for simplicity. Two tabs share one
   * IndexedDB but `service.subscribe` is a set of listeners held in memory, so
   * a tab is never told about a write made in another one. A watcher built on
   * it cannot fire — which is exactly why the first attempt at this guard
   * never triggered.
   *
   * What made the overwrite silent is subtle: the save path re-reads the item
   * immediately before submitting, so the base revision it uses is genuinely
   * current and nothing conflicts. The write is causally correct and still
   * wrong, because the document it writes was composed against a version this
   * tab last saw some time ago.
   *
   * The *body* is remembered, not the revision id. Revision ids change for
   * reasons that have nothing to do with the document: reconciliation replaces
   * a local revision with the server's once a mutation is accepted, and a
   * conversion writes a new revision without touching the content. Comparing
   * ids therefore refused perfectly good saves — a folder converted to a page
   * could not accept its first words. What the guard actually needs to ask is
   * "has the stored document changed under me", so that is what it compares.
   */
  const openedBody = useRef<string | null>(null);

  /**
   * The revision this editor opened on, pinned until the owner opens something
   * else (feature 006).
   *
   * Before live synchronization, `itemRevisionId` only changed when the owner
   * selected a different item, so reloading on it was free. Now another device's
   * write reaches this one within a second — and reloading on that would remount
   * the editor surface *while somebody is typing into it*, discarding whatever
   * they had not saved yet. The feature that was supposed to make two devices
   * feel like one workspace would have started eating paragraphs.
   *
   * So the editor holds the version it opened, and the save-time guard below
   * does the rest: it notices the stored document changed underneath, refuses,
   * and says so. The owner keeps their words and the newer version keeps its
   * own — which is the whole point of refusing rather than merging here.
   */
  const [openedOn, setOpenedOn] = useState<{
    readonly itemId: string;
    readonly revisionId: string | undefined;
  }>({ itemId, revisionId: itemRevisionId });
  if (openedOn.itemId !== itemId) {
    // Adjusting state during render when a prop changes: React's documented
    // pattern, and cheaper than an effect that would render once with the
    // previous item's document.
    setOpenedOn({ itemId, revisionId: itemRevisionId });
  }
  const openedRevisionId = openedOn.itemId === itemId ? openedOn.revisionId : itemRevisionId;

  useEffect(() => {
    let cancelled = false;
    const requestedRevisionId = openedRevisionId;
    void service.getItem(itemId).then((item) => {
      if (cancelled) {
        return;
      }
      openedBody.current = bodyFingerprint(item?.pageDocument?.body);
      if (
        requestedRevisionId !== undefined &&
        item !== null &&
        item.currentRevisionId !== requestedRevisionId
      ) {
        return;
      }
      if (item === null) {
        setState({ kind: "unavailable", reason: "This page is not available on this device yet." });
        return;
      }
      if (item.pageDocument == null) {
        setState({ kind: "ready", document: emptyDocument() });
        return;
      }
      const read = readDocumentBody(item.pageDocument.body);
      if (read.kind === "legacy") {
        setState({ kind: "legacy", body: read.body });
        return;
      }
      setState(
        read.result.ok
          ? { kind: "ready", document: read.result.document }
          : {
              kind: "unavailable",
              // Named, not silent. An owner whose document will not open needs
              // to know that it exists and is unreadable, which is a different
              // situation from an empty page.
              reason: `This document could not be read: ${read.result.problems[0]?.message ?? "unknown problem"}`,
            },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [service, itemId, openedRevisionId]);

  const surface = useRef<EditorSurfaceHandle | null>(null);

  const save = useCallback(async () => {
    const current = surface.current?.read() ?? null;
    if (current === null) {
      return;
    }
    setSaveError(null);

    const item = await service.getItem(itemId);
    if (item === null) {
      setSaveError("This page is not available on this device.");
      return;
    }
    const storedBody = item.pageDocument?.body;
    if (
      openedBody.current !== null &&
      bodyFingerprint(storedBody) !== openedBody.current &&
      // Only content is worth refusing over. An empty document appearing where
      // there was none is the system catching up with this owner's own
      // conversion, not another tab's work.
      bodyHoldsContent(storedBody)
    ) {
      // Refused, not merged, and not overwritten. Only the owner can say which
      // version they want, and the one thing that must not happen is the one
      // that used to: replacing content this tab never displayed, and
      // reporting it as saved.
      setSaveError(
        "This page changed somewhere else — another tab, or another device — after you opened it here. Saving now would replace that newer version. Copy anything you need, then reload to continue from the current one.",
      );
      return;
    }

    const edited = normaliseDocument(current);
    const result = await service.mutate(
      "page.document.replace",
      {
        itemId,
        baseRevisionId: item.currentRevisionId,
        document: {
          format: DOCUMENT_FORMAT,
          formatVersion: DOCUMENT_FORMAT_VERSION,
          body: serialiseDocument(edited),
        },
        pageLinkTargetIds: pageLinkTargets(edited),
      },
      [item.currentRevisionId],
    );

    if (!result.ok) {
      setSaveError(`${result.error.code}: ${result.error.title}`);
      return;
    }
    // This tab's own write is now the stored document, so it becomes the
    // baseline. Without this the guard above would refuse the owner's *second*
    // save in the same sitting, blaming a change they made themselves.
    const saved = await service.getItem(itemId);
    openedBody.current = bodyFingerprint(saved?.pageDocument?.body);
    setSavedLocally(true);
  }, [service, itemId]);

  /** Converts a legacy body on the owner's first deliberate action. */
  const beginEditingLegacy = useCallback(() => {
    if (state.kind !== "legacy") {
      return;
    }
    setState({ kind: "ready", document: upgradeLegacyBody(state.body) });
  }, [state]);

  if (state.kind === "loading") {
    return (
      <section className="panel" aria-label="Page content" aria-busy="true">
        <p className="muted" role="status">
          Loading this page…
        </p>
      </section>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <section className="panel" aria-label="Page content">
        <p
          className="status-banner"
          data-state="error"
          role="alert"
          data-testid="editor-unavailable"
        >
          {state.reason}
        </p>
      </section>
    );
  }

  if (state.kind === "legacy") {
    return (
      <section className="panel" aria-label="Page content">
        <h2>Page content</h2>
        <p className="muted" data-testid="legacy-document-notice">
          This page was written before the block editor existed, so it is shown as it was stored.
          Nothing has been changed. Converting it will keep the original content inside the new
          document.
        </p>
        <pre data-testid="legacy-document-body">{JSON.stringify(state.body, null, 2)}</pre>
        <button type="button" data-testid="convert-legacy-document" onClick={beginEditingLegacy}>
          Convert this page to the block editor
        </button>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Page content">
      <h2>Page content</h2>
      {!editingAllowed ? (
        <p className="status-banner" data-state="error" role="alert" data-testid="editing-refused">
          Editing is unavailable because this device cannot unlock its local store. Your existing
          content is still readable, and nothing has been lost. Unlock this device to continue
          writing.
        </p>
      ) : null}

      {/* Keyed on the item so switching pages remounts the editor rather than
          rebuilding it in place. A rebuild leaves a destroyed instance that
          subscribed components can still read from for one render, which is
          precisely the crash this split was made to remove. */}
      <EditorSurface
        // The *opened* revision, not the current one. Keying on the current one
        // would remount this surface every time another device wrote to the same
        // page, taking the owner's unsaved text with it.
        key={`${itemId}:${openedRevisionId ?? "unknown"}`}
        document={state.document}
        editable={editingAllowed}
        handleRef={surface}
        currentItemId={itemId}
        items={items}
        onOpenPage={onOpenPage}
      />

      <SaveStateIndicator service={service} itemId={itemId} />
      {/* Below the indicator, not instead of it: the line says which state the
          document is in, and these say what to do about the two states an owner
          cannot act on from a single word. */}
      <BlockedNotice service={service} itemId={itemId} />
      <ConflictNotice service={service} itemId={itemId} onResolved={() => setSavedLocally(false)} />

      <div className="field-row">
        <button
          type="button"
          data-testid="save-document"
          onClick={() => void save()}
          disabled={!editingAllowed}
        >
          Save document
        </button>
        {savedLocally && saveError === null ? (
          // Kept as the signal that *this* save completed, which is what the
          // journeys wait on. Whether the work is durable is a different
          // question, and the indicator below is the one that answers it.
          <span className="muted" data-testid="document-saved" role="status">
            Saved locally
          </span>
        ) : null}
        {saveError !== null ? (
          <span className="status-banner" data-state="error" role="alert" data-testid="save-error">
            {saveError}
          </span>
        ) : null}
      </div>
    </section>
  );
}
