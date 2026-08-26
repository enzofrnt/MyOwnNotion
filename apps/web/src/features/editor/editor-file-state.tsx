/**
 * Per-block file state in the editor (T102, FR-026, FR-071).
 *
 * A file reference created offline is honest about two separate facts: the
 * document operation exists locally, and the bytes may not be on the server
 * yet. "Synchronized" for the page waits for both; the block surface shows the
 * byte transfer on its own so one pending upload never reads as lost content.
 */

import type { ItemDto } from "@myownnotion/contracts";
import { isUuid, type Uuid } from "@myownnotion/domain";
import { useEffect, useState } from "react";
import { ContentApi } from "../../services/content-api.ts";
import { localContent } from "../../services/local-content.ts";
import { FR_COPY } from "../../ui/copy/fr.ts";
import { EditorFileTransferQueue, type EditorFileTransferState } from "./editor-files.ts";

export type FileBlockAvailability =
  | { readonly kind: "local-only"; readonly detail: string }
  | { readonly kind: "transferring"; readonly detail: string }
  | { readonly kind: "synchronized"; readonly detail: string }
  | { readonly kind: "blocked"; readonly detail: string };

export type EditorFileResource =
  | {
      readonly kind: "local";
      readonly file: File;
      readonly fileName: string;
      readonly mediaType: string;
      readonly byteLength: number;
    }
  | {
      readonly kind: "loading";
    }
  | {
      readonly kind: "remote";
      readonly fileName: string;
      readonly mediaType: string;
      readonly byteLength: number;
    }
  | {
      readonly kind: "unavailable";
      readonly detail: string;
    };

const queue = new EditorFileTransferQueue();
let connectedToGlobalStatus = false;

// A refused attempt must resume by itself when connectivity returns (FR-027):
// the owner dropped one file, not one file plus a retry chore.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void queue.flush();
  });
}

/** The editor-wide transfer queue; blocks subscribe to their own item. */
export function editorFileTransferQueue(): EditorFileTransferQueue {
  if (!connectedToGlobalStatus) {
    localContent().connectFileTransferStatus(queue);
    connectedToGlobalStatus = true;
  }
  return queue;
}

function describe(state: EditorFileTransferState): FileBlockAvailability {
  switch (state.kind) {
    case "queued":
      return { kind: "local-only", detail: "Enregistré localement — transfert en attente" };
    case "uploading": {
      const percent =
        state.total > 0 ? Math.min(100, Math.round((state.sent / state.total) * 100)) : 0;
      return { kind: "transferring", detail: `Transfert en cours (${percent} %)` };
    }
    case "verifying":
      return { kind: "transferring", detail: "Vérification du serveur…" };
    case "synchronized":
      return { kind: "synchronized", detail: "Octets vérifiés sur le serveur" };
    case "blocked":
      return { kind: "blocked", detail: state.reason };
  }
}

export function useFileBlockAvailability(fileItemId: Uuid | null): FileBlockAvailability | null {
  const initial = fileItemId === null ? undefined : queue.stateFor(fileItemId);
  const [availability, setAvailability] = useState<FileBlockAvailability | null>(
    initial === undefined ? null : describe(initial),
  );
  useEffect(() => {
    if (fileItemId === null) return;
    return queue.subscribe((states) => {
      const state = states.get(fileItemId);
      setAvailability(state === undefined ? null : describe(state));
    });
  }, [fileItemId]);
  return availability;
}

function localResource(file: File): EditorFileResource {
  return {
    kind: "local",
    file,
    fileName: file.name,
    mediaType: file.type || "application/octet-stream",
    byteLength: file.size,
  };
}

function remoteResource(item: ItemDto): EditorFileResource | null {
  if (item.kind !== "file" || item.file === undefined || item.file === null) return null;
  return {
    kind: "remote",
    fileName: item.file.originalName,
    mediaType: item.file.mediaType,
    byteLength: item.file.byteLength,
  };
}

/**
 * Resolves a media block against the in-memory upload bytes first, then the
 * verified feature-005 item. An unknown reference is never relabelled as a
 * queued upload: that was the source of a permanent false “pending” state on
 * pages opened from another browser.
 */
export function useEditorFileResource(fileItemId: string | undefined): EditorFileResource | null {
  const id = isUuid(fileItemId) ? fileItemId : null;
  const localFile = id === null ? null : queue.localFileFor(id);
  const [resource, setResource] = useState<EditorFileResource | null>(() =>
    id === null ? null : localFile === null ? { kind: "loading" } : localResource(localFile),
  );

  useEffect(() => {
    if (id === null) {
      setResource(null);
      return;
    }
    let cancelled = false;
    const setLocalWhenPresent = (): boolean => {
      const file = queue.localFileFor(id);
      if (file === null) return false;
      setResource((current) =>
        current?.kind === "local" && current.file === file ? current : localResource(file),
      );
      return true;
    };
    const unsubscribe = queue.subscribe(() => {
      if (!cancelled) setLocalWhenPresent();
    });
    if (!setLocalWhenPresent()) {
      setResource({ kind: "loading" });
      const api = new ContentApi();
      void api.getItem(id).then((result) => {
        if (cancelled || setLocalWhenPresent()) return;
        if (result.ok) {
          setResource(
            remoteResource(result.value) ?? {
              kind: "unavailable",
              detail: FR_COPY.editor.files.unavailable,
            },
          );
          return;
        }
        setResource({
          kind: "unavailable",
          detail: result.offline
            ? FR_COPY.editor.files.offlineUnavailable
            : FR_COPY.editor.files.unavailable,
        });
      });
    }
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id]);

  return resource;
}

/**
 * The status line rendered inside image and fileEmbed blocks. It never uses
 * colour alone (FR-038) and never claims more than the bytes' real state.
 */
export function EditorFileStateLine({ fileItemId }: { readonly fileItemId: string | undefined }) {
  const availability = useFileBlockAvailability(
    typeof fileItemId === "string" && fileItemId !== "" ? (fileItemId as Uuid) : null,
  );
  if (availability === null) return null;
  return (
    <p className="editor-file-state" data-state={availability.kind}>
      {availability.detail}
    </p>
  );
}
