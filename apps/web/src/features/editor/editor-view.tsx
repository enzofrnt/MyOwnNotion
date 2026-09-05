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
import { FR_COPY } from "../../ui/copy/fr.ts";
import { AsyncState } from "../../ui/primitives/async-state.tsx";
import { PageAmbiguityNotice } from "../sync/page-ambiguity-notice.tsx";
import { usePageReconciler } from "../sync/use-page-reconciler.ts";
import { PageContentSkeleton } from "../workspace/page-content-skeleton.tsx";
import type { CreateSubpage } from "./editor-menus/slash-menu.tsx";
import { EditorSurface, type EditorSurfaceHandle } from "./editor-surface.tsx";
import { type EditorDurableSession, EditorSyncStatus } from "./editor-sync-status.tsx";
import { captureScrollAnchor, editorScrollContainer } from "./editor-view-state.ts";

import { usePageScrollRestoration } from "./use-page-scroll-restoration.ts";

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

// Session-backed surfaces read their initial authority from the session. Keep
// the compatibility placeholder stable so a status-only parent render cannot
// needlessly rerender BlockNote and replace a floating control mid-gesture.
const SESSION_DOCUMENT_PLACEHOLDER = emptyDocument();

export function EditorView({
  service,
  itemId,
  editingAllowed = true,
  items = [],
  onCreateSubpage,
  onOpenPage,
  initialScrollAnchor = null,
  onCaptureScrollAnchor,
  discoverable = true,
}: {
  readonly service: LocalContentService;
  readonly itemId: Uuid;
  /** False when the device key is unavailable and nothing can be sealed. */
  readonly editingAllowed?: boolean;
  readonly items?: readonly ProjectedItem[];
  readonly onCreateSubpage?: CreateSubpage;
  readonly onOpenPage?: (itemId: string) => void;
  /** Where the owner left this page, restored once blocks are mounted (FR-009). */
  readonly initialScrollAnchor?: PageScrollAnchor | null;
  /** Called when the surface unmounts, so leaving a page remembers its place. */
  readonly onCaptureScrollAnchor?: (itemId: Uuid, anchor: PageScrollAnchor) => void;
  /** False for keep-alive sessions that must not match Playwright/a11y locators. */
  readonly discoverable?: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [editorSettled, setEditorSettled] = useState(true);
  const editorRoot = useRef<HTMLElement | null>(null);
  usePageScrollRestoration(state.kind === "ready", discoverable, initialScrollAnchor, editorRoot);
  const [ambiguities, setAmbiguities] = useState<readonly PageAmbiguityRecord[]>([]);

  const resolveAmbiguity = useCallback(
    (ambiguityId: string, decision: "confirm-delete" | "restore-change") => {
      void (async () => {
        const record = ambiguities.find((candidate) => candidate.ambiguityId === ambiguityId);
        if (record === undefined) return;
        const requestId = generateUuidV7() as Uuid;
        const resolved = await service.pageOperationsApi.resolveAmbiguity(
          ambiguityId as Uuid,
          decision === "confirm-delete"
            ? { requestId, decision }
            : {
                requestId,
                decision,
                parentBlockId: record.details.recoverablePlacement?.parentBlockId ?? null,
                beforeBlockId: record.details.recoverablePlacement?.beforeBlockId ?? null,
              },
        );
        if (state.kind === "ready") await state.reconciler.synchronize();
        const records = await service.pageOperationLog.listOpenAmbiguities(itemId);
        setAmbiguities(records);
        if (!resolved.ok) return;
      })();
    },
    [service, itemId, state, ambiguities],
  );

  // Leaving the page records where the viewport stopped. The anchor is kept
  // fresh on every scroll frame rather than queried at teardown: by the time
  // this surface unmounts, BlockNote has already removed its blocks from the
  // document, and a teardown-time query would always find nothing.
  const latestAnchorRef = useRef<PageScrollAnchor | null>(null);
  useEffect(() => {
    if (state.kind !== "ready" || !discoverable) return;
    let raf = 0;
    const onScroll = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const root = editorRoot.current;
        if (root === null) return;
        const anchor = captureScrollAnchor(root);
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
    const scrollTarget: EventTarget =
      (editorRoot.current === null ? null : editorScrollContainer(editorRoot.current)) ?? window;
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollTarget.removeEventListener("scroll", onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
      const anchor = latestAnchorRef.current;
      if (anchor !== null) onCaptureScrollAnchor?.(itemId, anchor);
    };
  }, [state, itemId, onCaptureScrollAnchor, discoverable]);

  useEffect(() => {
    let cancelled = false;
    let releaseOpened = () => {};
    setState({ kind: "loading" });
    setEditorSettled(true);
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
          const unsubscribeAmbiguities = opened.session.subscribe(() => {
            refreshAmbiguities();
          });
          let released = false;
          releaseOpened = () => {
            if (released) return;
            released = true;
            unsubscribeAmbiguities();
            opened.close();
          };
          setState({
            kind: "ready",
            mode: opened.mode,
            session: opened.session,
            reconciler: opened.reconciler,
            close: releaseOpened,
          });
          return;
        }
        setState({
          kind: "unavailable",
          reason:
            opened.offline && !editingAllowed
              ? FR_COPY.editor.surface.offlineUnavailable
              : opened.message,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "unavailable",
          reason:
            error instanceof Error
              ? FR_COPY.editor.surface.unavailableWithDetail(error.message)
              : FR_COPY.editor.surface.unavailable,
        });
      });
    return () => {
      cancelled = true;
      releaseOpened();
    };
    // The item, and nothing about its revision: another device advancing the
    // revision must never remount this editor under somebody's cursor. A
    // converting branch hands over in place (session-level upgrade), so no
    // remount is ever needed while the surface stays open.
  }, [service, itemId, editingAllowed]);

  useEffect(() => {
    if (!discoverable) return;
    let cancelled = false;
    void service.getItem(itemId).then((item) => {
      if (cancelled || item === null || item.localAvailability !== "offloaded") return;
      setState((current) => {
        if (current.kind === "ready") current.close();
        if (current.kind === "unavailable") return current;
        return {
          kind: "unavailable",
          reason:
            "This page was released from this device and needs a connection to download again.",
        };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [discoverable, itemId, service]);

  useEffect(() => {
    if (!discoverable || ambiguities.length === 0) return;
    const timer = window.setInterval(() => {
      void service.pageOperationLog.listOpenAmbiguities(itemId).then(setAmbiguities);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [ambiguities.length, discoverable, itemId, service]);

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
      <section className="workspace-page-editor" aria-label={FR_COPY.editor.surface.contentLabel}>
        <PageContentSkeleton
          testId={discoverable ? "editor-loading-skeleton" : `editor-loading-skeleton-${itemId}`}
        />
      </section>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <section className="workspace-page-editor" aria-label={FR_COPY.editor.surface.contentLabel}>
        <AsyncState compact kind="error" description={state.reason} testId="editor-unavailable" />
      </section>
    );
  }

  return (
    <section
      ref={editorRoot}
      className="workspace-page-editor"
      aria-label={FR_COPY.editor.surface.contentLabel}
      data-testid={discoverable ? "operational-editor" : undefined}
    >
      <PageAmbiguityNotice records={ambiguities} onResolve={resolveAmbiguity} />
      {/* Keyed by item and mode alone: the session owns causality, so another
          device's write must never remount this surface. A mode change (an
          offline branch converting) is exactly the one remount that should
          happen, because the authority itself changed. */}
      <EditorSurface
        key={`${itemId}:${state.mode}`}
        document={SESSION_DOCUMENT_PLACEHOLDER}
        editable={editingAllowed}
        handleRef={surface}
        currentItemId={itemId}
        items={items}
        onCreateSubpage={onCreateSubpage}
        onOpenPage={onOpenPage}
        onSettlementChange={setEditorSettled}
        session={state.session}
        discoverable={discoverable}
      />
      <EditorSyncStatus
        session={state.session}
        editorSettled={editorSettled}
        discoverable={discoverable}
      />
    </section>
  );
}
