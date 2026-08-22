/**
 * The editing surface (T022, T023, T026-T029; operational-only per V1 scope).
 *
 * Every page opens through a durable editing session. When shared operational
 * state exists (or can be activated now), the session commits every gesture
 * encrypted to this device before the interface calls it saved and merges
 * remote work by identity. When the page was never activated and the device
 * is offline, it opens on a local semantic branch instead: editing works,
 * durability is local, and the reconciler converts the branch to shared
 * history on the first online pass.
 *
 * There is no save button and no second writing path. What this surface
 * refuses to do is pretend: the status line distinguishes « enregistré sur
 * cet appareil » from « synchronisé » and never claims the second before its
 * proof exists (FR-026, FR-052, FR-053, FR-061).
 */

import type {
  PageAmbiguityRecord,
  PageReconciler,
  PageScrollAnchor,
  ProjectedItem,
} from "@myownnotion/client-core";
import type { Uuid } from "@myownnotion/domain";
import { emptyDocument, generateUuidV7 } from "@myownnotion/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { PageAmbiguityNotice } from "../sync/page-ambiguity-notice.tsx";
import { usePageReconciler } from "../sync/use-page-reconciler.ts";
import { EditorSurface, type EditorSurfaceHandle } from "./editor-surface.tsx";
import { type EditorDurableSession, EditorSyncStatus } from "./editor-sync-status.tsx";
import { captureScrollAnchor, restoreScrollAnchor } from "./editor-view-state.ts";

type LoadState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly mode: "active" | "legacy-branch";
      readonly session: EditorDurableSession;
      readonly reconciler: PageReconciler;
      readonly close: () => void;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

export function EditorView({
  service,
  itemId,
  editingAllowed = true,
  items = [],
  onOpenPage,
  initialScrollAnchor = null,
  onCaptureScrollAnchor,
}: {
  readonly service: LocalContentService;
  readonly itemId: Uuid;
  /** False when the device key is unavailable and nothing can be sealed. */
  readonly editingAllowed?: boolean;
  readonly items?: readonly ProjectedItem[];
  readonly onOpenPage?: (itemId: string) => void;
  /** Where the owner left this page, restored once blocks are mounted (FR-009). */
  readonly initialScrollAnchor?: PageScrollAnchor | null;
  /** Called when the surface unmounts, so leaving a page remembers its place. */
  readonly onCaptureScrollAnchor?: (itemId: Uuid, anchor: PageScrollAnchor) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const restorePending = useRef(initialScrollAnchor);
  const [ambiguities, setAmbiguities] = useState<readonly PageAmbiguityRecord[]>([]);

  const resolveAmbiguity = useCallback(
    (ambiguityId: string, decision: "confirm-delete" | "restore-change") => {
      void (async () => {
        await service.pageOperationsApi.resolveAmbiguity(ambiguityId as Uuid, {
          requestId: generateUuidV7() as Uuid,
          decision,
        });
        if (state.kind === "ready") void state.reconciler.synchronize();
        const records = await service.pageOperationLog.listOpenAmbiguities(itemId);
        setAmbiguities(records);
      })();
    },
    [service, itemId, state],
  );

  // Restored once the surface is ready, then retried briefly: early attempts
  // can run against a shell BlockNote has not filled yet, and a document too
  // short to hold the position clamps the scroll back to the top — the late
  // jump FR-009 forbids. The anchor is consumed on the first attempt so a
  // retry never fights the owner's own scrolling.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const anchor = restorePending.current;
    if (anchor === null) return;
    restorePending.current = null;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = (): boolean =>
      window.scrollY > 0 || document.documentElement.scrollHeight <= window.innerHeight;
    const attempt = (): void => {
      restoreScrollAnchor(anchor);
      attempts += 1;
      if (settled() || attempts >= 10) return;
      timer = setTimeout(attempt, 120);
    };
    const frame = requestAnimationFrame(attempt);
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [state]);

  // Leaving the page records where the viewport stopped. The anchor is kept
  // fresh on every scroll frame rather than queried at teardown: by the time
  // this surface unmounts, BlockNote has already removed its blocks from the
  // document, and a teardown-time query would always find nothing.
  const latestAnchorRef = useRef<PageScrollAnchor | null>(null);
  useEffect(() => {
    if (state.kind !== "ready") return;
    let raf = 0;
    const onScroll = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const anchor = captureScrollAnchor();
        if (anchor === null) return;
        const previous = latestAnchorRef.current;
        const moved =
          previous === null ||
          previous.blockId !== anchor.blockId ||
          Math.abs(previous.offset - anchor.offset) > 32 ||
          Math.abs(previous.fallbackPixel - anchor.fallbackPixel) > 64;
        latestAnchorRef.current = anchor;
        // Meaningful moves persist immediately: a navigation that races this
        // frame must not cost the owner their place in the document.
        if (moved) onCaptureScrollAnchor?.(itemId, anchor);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
      const anchor = latestAnchorRef.current;
      if (anchor !== null) onCaptureScrollAnchor?.(itemId, anchor);
    };
  }, [state, itemId, onCaptureScrollAnchor]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    let refreshAmbiguities = () => {};
    void service
      .openOperationalPage(itemId)
      .then((opened) => {
        if (cancelled) {
          if (opened.ok) opened.close();
          return;
        }
        if (opened.ok) {
          refreshAmbiguities = () => {
            void service.pageOperationLog.listOpenAmbiguities(itemId).then((records) => {
              if (!cancelled) setAmbiguities(records);
            });
          };
          refreshAmbiguities();
          setState({
            kind: "ready",
            mode: opened.mode,
            session: opened.session,
            reconciler: opened.reconciler,
            close: opened.close,
          });
          return;
        }
        setState({
          kind: "unavailable",
          reason:
            opened.offline && !editingAllowed
              ? "This page cannot be opened while offline on a device that cannot write locally."
              : opened.message,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "unavailable",
          reason:
            error instanceof Error
              ? `This page could not be opened safely: ${error.message}`
              : "This page could not be opened safely.",
        });
      });
    return () => {
      cancelled = true;
    };
    // The item, and nothing about its revision: another device advancing the
    // revision must never remount this editor under somebody's cursor. A
    // converting branch hands over in place (session-level upgrade), so no
    // remount is ever needed while the surface stays open.
  }, [service, itemId, editingAllowed]);

  // Releases the session subscription when the owner leaves the page, so a
  // closed surface never keeps adopting remote merges into a dead editor.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const close = state.close;
    return () => close();
  }, [state]);

  const ready =
    state.kind === "ready"
      ? { session: state.session, reconciler: state.reconciler, mode: state.mode }
      : null;
  usePageReconciler(ready);

  const surface = useRef<EditorSurfaceHandle | null>(null);

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

  return (
    <section className="panel" aria-label="Page content" data-testid="operational-editor">
      <PageAmbiguityNotice records={ambiguities} onResolve={resolveAmbiguity} />
      {/* Keyed by item and mode alone: the session owns causality, so another
          device's write must never remount this surface. A mode change (an
          offline branch converting) is exactly the one remount that should
          happen, because the authority itself changed. */}
      <EditorSurface
        key={`${itemId}:${state.mode}`}
        document={emptyDocument()}
        editable={editingAllowed}
        handleRef={surface}
        currentItemId={itemId}
        items={items}
        onOpenPage={onOpenPage}
        session={state.session}
      />
      <EditorSyncStatus session={state.session} />
    </section>
  );
}
