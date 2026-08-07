/**
 * Minimal versioned page-document form (T045, US6).
 *
 * This slice deliberately has no rich editor: the canonical document
 * envelope is edited through a plain JSON text control wired to local
 * projection reads and offline-capable commands.
 */
import { useCallback, useEffect, useState } from "react";
import type { Uuid } from "@myownnotion/domain";
import type { LocalContentService } from "../../services/local-content.ts";

export function PageDocumentForm({
  service,
  itemId,
}: {
  readonly service: LocalContentService;
  readonly itemId: Uuid;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [baseRevisionId, setBaseRevisionId] = useState<Uuid | null>(null);

  useEffect(() => {
    void service.getItem(itemId).then((item) => {
      if (item?.pageDocument != null) {
        setText(JSON.stringify(item.pageDocument.body, null, 2));
        setBaseRevisionId(item.currentRevisionId);
      }
    });
  }, [service, itemId]);

  const save = useCallback(async () => {
    setStatus("idle");
    setErrorMessage(null);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text.trim() === "" ? "{}" : text) as Record<string, unknown>;
    } catch {
      setStatus("error");
      setErrorMessage("The document body must be valid JSON");
      return;
    }
    const item = await service.getItem(itemId);
    if (item === null) {
      setStatus("error");
      setErrorMessage("Page is not available locally");
      return;
    }
    const result = await service.mutate(
      "page.document.replace",
      {
        itemId,
        baseRevisionId: item.currentRevisionId,
        document: { format: "myownnotion.document+json", formatVersion: 1, body },
      },
      [item.currentRevisionId],
    );
    if (!result.ok) {
      setStatus("error");
      setErrorMessage(`${result.error.code}: ${result.error.title}`);
      return;
    }
    setStatus("saved");
    const updated = await service.getItem(itemId);
    setBaseRevisionId(updated?.currentRevisionId ?? baseRevisionId);
  }, [service, itemId, text, baseRevisionId]);

  return (
    <section className="panel" aria-label="Page document">
      <h2>Page document</h2>
      <p className="muted">
        Canonical envelope <code>myownnotion.document+json</code> v1 — base revision{" "}
        <code data-testid="document-base-revision">{baseRevisionId ?? "unknown"}</code>
      </p>
      <label htmlFor={`document-body-${itemId}`} className="muted">
        Body (JSON)
      </label>
      <textarea
        id={`document-body-${itemId}`}
        data-testid="document-body"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="field-row">
        <button type="button" data-testid="save-document" onClick={() => void save()}>
          Save document
        </button>
        {status === "saved" ? (
          <span className="muted" data-testid="document-saved" role="status">
            Saved locally — synchronization state above reflects server durability
          </span>
        ) : null}
        {status === "error" && errorMessage !== null ? (
          <span className="status-banner" data-state="error" role="alert">
            {errorMessage}
          </span>
        ) : null}
      </div>
    </section>
  );
}
