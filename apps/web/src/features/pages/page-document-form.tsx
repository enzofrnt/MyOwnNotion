import type { ProjectedItem } from "@myownnotion/client-core";
import {
  EDITOR_DOCUMENT_VERSION,
  type EditorDocument,
  normalizePageDocumentForEditor,
  type Uuid,
} from "@myownnotion/domain";
import { useCallback, useEffect, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { BlockEditor } from "../editor/block-editor.tsx";
import type { SaveCoordinatorState } from "../editor/save-coordinator.ts";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly document: EditorDocument; readonly baseRevisionId: Uuid }
  | { readonly status: "error"; readonly message: string };

export function PageDocumentForm({
  service,
  itemId,
  items,
  onNavigate,
}: {
  readonly service: LocalContentService;
  readonly itemId: Uuid;
  readonly items: readonly ProjectedItem[];
  readonly onNavigate: (itemId: Uuid) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [saveState, setSaveState] = useState<SaveCoordinatorState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    setSaveState({ status: "idle" });
    void service.getItem(itemId).then((item) => {
      if (cancelled) {
        return;
      }
      if (item === null || item.kind !== "page" || item.pageDocument === null) {
        setLoadState({ status: "error", message: "Page is not available locally" });
        return;
      }
      const normalized = normalizePageDocumentForEditor(item.pageDocument);
      if (!normalized.ok) {
        setLoadState({
          status: "error",
          message: `${normalized.error.code}: this page uses content this editor cannot safely open`,
        });
        return;
      }
      if (item.pageDocument.formatVersion === EDITOR_DOCUMENT_VERSION) {
        setSaveState({ status: "saved-local" });
      }
      setLoadState({
        status: "ready",
        document: normalized.value,
        baseRevisionId: item.currentRevisionId,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [service, itemId]);

  const save = useCallback(
    async (document: EditorDocument) => {
      const result = await service.replacePageDocument(itemId, document);
      if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.title}`);
      }
      setSaveState({ status: "saved-local" });
    },
    [service, itemId],
  );

  return (
    <section className="panel page-editor-panel" aria-label="Page document">
      <h2>Page editor</h2>
      {loadState.status === "loading" ? <p role="status">Loading page document…</p> : null}
      {loadState.status === "error" ? (
        <p className="status-banner" data-state="error" role="alert">
          {loadState.message}. The stored document was left unchanged.
        </p>
      ) : null}
      {loadState.status === "ready" ? (
        <>
          <p className="muted">
            Versioned local-first document — base revision{" "}
            <code data-testid="document-base-revision">{loadState.baseRevisionId}</code>
          </p>
          <BlockEditor
            key={itemId}
            initialDocument={loadState.document}
            saveState={saveState}
            onSave={save}
            onSaveStateChange={setSaveState}
            sourceItemId={itemId}
            wikiLinkCandidates={items
              .filter((item) => item.kind === "page" && item.lifecycle === "active")
              .map((item) => ({ id: item.id, name: item.name }))}
            onNavigateWikiLink={onNavigate}
          />
        </>
      ) : null}
    </section>
  );
}
