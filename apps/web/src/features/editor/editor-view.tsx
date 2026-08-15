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

import type { BlockDocument, JsonObject, Uuid } from "@myownnotion/domain";
import {
  DOCUMENT_FORMAT,
  DOCUMENT_FORMAT_VERSION,
  emptyDocument,
  normaliseDocument,
  readDocumentBody,
  serialiseDocument,
  upgradeLegacyBody,
} from "@myownnotion/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { EditorSurface, type EditorSurfaceHandle } from "./editor-surface.tsx";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly document: BlockDocument }
  /** A version 1 body, shown as it is and not converted until an edit. */
  | { readonly kind: "legacy"; readonly body: JsonObject }
  | { readonly kind: "unavailable"; readonly reason: string };

export function EditorView({
  service,
  itemId,
  editingAllowed = true,
}: {
  readonly service: LocalContentService;
  readonly itemId: Uuid;
  /** False when the device key is unavailable and nothing can be sealed. */
  readonly editingAllowed?: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  // A placeholder for the real save state, which arrives with US2 in the next
  // batch. It says "saved locally" and nothing more, because that is all this
  // component can honestly claim today: the server confirmation it would need
  // to say "saved" is exactly what FR-008 forbids assuming.
  const [savedLocally, setSavedLocally] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void service.getItem(itemId).then((item) => {
      if (cancelled) {
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
  }, [service, itemId]);

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
      },
      [item.currentRevisionId],
    );

    if (!result.ok) {
      setSaveError(`${result.error.code}: ${result.error.title}`);
      return;
    }
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
        key={itemId}
        document={state.document}
        editable={editingAllowed}
        handleRef={surface}
      />

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
          <span className="muted" data-testid="document-saved" role="status">
            Saved locally — synchronization state above reflects server durability
          </span>
        ) : null}
        {saveError !== null ? (
          <span className="status-banner" data-state="error" role="alert">
            {saveError}
          </span>
        ) : null}
      </div>
    </section>
  );
}
