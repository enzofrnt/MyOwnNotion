/**
 * Reconciliation lifecycle for one open page (T114, FR-027, FR-053).
 *
 * Three moments must flush work without waiting for a keystroke: mounting a
 * page whose device was interrupted mid-send, the browser coming back online,
 * and the owner returning to a page that still owed updates. The hook owns
 * all three so no surface has to remember them.
 *
 * A legacy branch is deliberately not synchronized out of band: it schedules
 * its own conversion from inside its gesture queue, and an external pass
 * could convert behind that queue's back.
 */

import type { PageReconciler } from "@myownnotion/client-core";
import { useEffect } from "react";
import { editorFileTransferQueue } from "../editor/editor-file-state.tsx";

export function usePageReconciler(
  page: {
    readonly session: {
      readonly setOnline: (online: boolean) => void;
    };
    readonly reconciler: PageReconciler;
    readonly mode: "active" | "legacy-branch";
  } | null,
): void {
  const session = page?.session;
  const reconciler = page?.reconciler;
  const mode = page?.mode;
  useEffect(() => {
    if (session === undefined || reconciler === undefined || mode === undefined) return;
    const goOnline = (): void => {
      session.setOnline(true);
      if (mode === "active") void reconciler.synchronize();
      // Byte transfers refused while offline retry by themselves.
      void editorFileTransferQueue().flush();
    };
    const goOffline = (): void => {
      session.setOnline(false);
    };

    // Boot initialization has already returned rows interrupted in `sending`
    // to the queue. This first page pass therefore only handles live work and
    // cannot reset another page's active transport.
    if (mode === "active") void reconciler.synchronize();
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      goOffline();
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [session, reconciler, mode]);
}
