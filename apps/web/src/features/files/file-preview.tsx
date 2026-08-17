/**
 * Showing a file without giving it the workspace (T027, T028, T029, US3).
 *
 * Every preview goes through one sandboxed frame, including the formats that
 * look harmless. That uniformity is the design: the moment previewing is
 * decided per format, someone adds a format and forgets which branch was the
 * safe one.
 *
 * The frame receives a blob URL rather than the application's own route, and
 * carries no `allow-same-origin`. Without that token the frame is a unique
 * opaque origin: script inside it cannot read this document, cannot reach the
 * session cookie, and cannot call the API as the owner. SVG and PDF can both
 * carry script, and a file is bytes the owner obtained from somewhere else —
 * so the question is not whether this particular file is hostile but what it
 * could do if it were.
 *
 * The server sends the same bytes with `Content-Disposition: attachment`,
 * `nosniff`, and a policy denying every capability. Belt and braces, because
 * each of those alone has a known bypass shape.
 */

import { useEffect, useRef, useState } from "react";
import { formatByteLength } from "../hierarchy/file-node.tsx";

/** What the application renders inside its own sandboxed frame. */
const PREVIEWABLE = new Set([
  "application/pdf",
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

export function canPreview(mediaType: string): boolean {
  return PREVIEWABLE.has(mediaType.split(";")[0]?.trim().toLowerCase() ?? "");
}

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "failed"; readonly reason: string };

export function FilePreview({
  fileItemId,
  fileName,
  mediaType,
  byteLength,
  availability = "present",
  onFetched,
}: {
  readonly fileItemId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly byteLength: number;
  /**
   * What this device holds (T043, FR-018).
   *
   * Opening something the device released fetches it, and says so while it
   * does. The distinction from `present` matters even though the fetch is the
   * same request: an owner who was told the file is not held locally and then
   * sees it open has learnt how their device behaves, and one who saw an
   * unexplained pause has learnt that it is slow.
   */
  readonly availability?: "present" | "offloaded" | "never-fetched";
  /** Called once the bytes are here, so the projection can record it. */
  readonly onFetched?: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  // Held in a ref so the fetch effect never re-runs because the callback's
  // identity changed. See the note on the effect's dependency list.
  const notifyFetched = useRef(onFetched);
  notifyFetched.current = onFetched;

  useEffect(() => {
    if (!canPreview(mediaType)) {
      return;
    }
    let revoke: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/v1/files/${fileItemId}/content`, {
          credentials: "same-origin",
        });
        if (!response.ok) {
          setLoad({ kind: "failed", reason: "This file could not be loaded." });
          return;
        }
        // Fetched successfully, so this device now holds it again. Recorded by
        // the caller through `onFetched`, because this component renders and the
        // projection is not its to write.
        notifyFetched.current?.();
        // Re-typed from what the server stored rather than from what the blob
        // claims: the response is deliberately served as an attachment, and the
        // frame needs a type it will render.
        const blob = new Blob([await response.arrayBuffer()], { type: mediaType });
        const url = URL.createObjectURL(blob);
        revoke = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setLoad({ kind: "ready", url });
      } catch {
        setLoad({ kind: "failed", reason: "This file could not be loaded on this device." });
      }
    })();
    return () => {
      cancelled = true;
      if (revoke !== null) {
        // Released on unmount. A blob URL kept alive holds the whole file in
        // memory, which for a 2 GB attachment is the difference between a
        // preview and a crash.
        URL.revokeObjectURL(revoke);
      }
    };
    // Deliberately not depending on `onFetched`. Callers pass an inline closure
    // that refreshes their list, so a dependency here would be: fetch →
    // onFetched → refresh → re-render → new closure → fetch, without end. The
    // ref below keeps the callback current without making the effect re-run,
    // which is the same shape the tree's Escape handler uses for the same
    // reason.
  }, [fileItemId, mediaType]);

  if (!canPreview(mediaType)) {
    return (
      <UnsupportedFile
        fileItemId={fileItemId}
        fileName={fileName}
        mediaType={mediaType}
        byteLength={byteLength}
      />
    );
  }

  if (load.kind === "failed") {
    return (
      <p className="status-banner" data-state="error" role="alert" data-testid="preview-failed">
        {availability === "present"
          ? load.reason
          : // Not held here and not reachable: the file exists, the connection
            // does not. Saying "could not be loaded" alone would let an owner
            // conclude it is gone.
            `${fileName} is not on this device and could not be fetched. It is still on the server; try again when you have a connection.`}
      </p>
    );
  }

  if (load.kind === "loading") {
    // Says *why* it is waiting, not merely that it is. Offline, it says the
    // connection is what is missing rather than implying the file is — the
    // sentence this feature works hardest to avoid.
    const because =
      availability === "present"
        ? `Loading ${fileName}…`
        : typeof navigator !== "undefined" && !navigator.onLine
          ? `${fileName} is not on this device, and there is no connection to fetch it. It is still on the server.`
          : availability === "offloaded"
            ? `Fetching ${fileName} again — this device had released it to stay within its storage limit.`
            : `Fetching ${fileName} for the first time on this device…`;
    return (
      <p className="muted" role="status" aria-busy="true" data-testid="preview-loading">
        {because}
      </p>
    );
  }

  return (
    <iframe
      // No `allow-same-origin`: with it, script in the file would run as this
      // origin and the sandbox would be decoration. Scripts are allowed inside
      // because a PDF viewer needs them, and the opaque origin is what makes
      // that safe.
      sandbox="allow-scripts"
      src={load.url}
      title={`Preview of ${fileName}`}
      className="file-preview"
      data-testid="file-preview"
      referrerPolicy="no-referrer"
    />
  );
}

/** Name, type, size and a way out (T029, FR-012). */
export function UnsupportedFile({
  fileItemId,
  fileName,
  mediaType,
  byteLength,
}: {
  readonly fileItemId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly byteLength: number;
}) {
  return (
    <section className="panel" data-testid="file-unsupported" aria-label={`About ${fileName}`}>
      <p>
        <strong data-testid="unsupported-name">{fileName}</strong>
      </p>
      <p className="muted">
        <span data-testid="unsupported-type">{mediaType}</span>
        {" · "}
        <span data-testid="unsupported-size">{formatByteLength(byteLength)}</span>
      </p>
      <p className="muted">
        This kind of file is not previewed here. Downloading it opens it in whatever application you
        normally use for it.
      </p>
      <a
        href={`/v1/files/${fileItemId}/content`}
        download={fileName}
        data-testid="unsupported-download"
      >
        Download {fileName}
      </a>
    </section>
  );
}
