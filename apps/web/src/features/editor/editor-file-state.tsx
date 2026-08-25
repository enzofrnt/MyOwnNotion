/**
 * Per-block file state in the editor (T102, FR-026, FR-071).
 *
 * A file reference created offline is honest about two separate facts: the
 * document operation exists locally, and the bytes may not be on the server
 * yet. "Synchronized" for the page waits for both; the block surface shows the
 * byte transfer on its own so one pending upload never reads as lost content.
 */

import type { Uuid } from "@myownnotion/domain";
import { useEffect, useState } from "react";
import { localContent } from "../../services/local-content.ts";
import { EditorFileTransferQueue, type EditorFileTransferState } from "./editor-files.ts";

export type FileBlockAvailability =
  | { readonly kind: "local-only"; readonly detail: string }
  | { readonly kind: "transferring"; readonly detail: string }
  | { readonly kind: "synchronized"; readonly detail: string }
  | { readonly kind: "blocked"; readonly detail: string };

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
  const [availability, setAvailability] = useState<FileBlockAvailability | null>(
    fileItemId === null ? null : describe(queue.stateFor(fileItemId)),
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
