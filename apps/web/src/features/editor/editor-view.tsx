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

import type { PageReconciler, ProjectedItem } from "@myownnotion/client-core";
import type { Uuid } from "@myownnotion/domain";
import { emptyDocument } from "@myownnotion/domain";
import { useEffect, useRef, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { EditorSurface, type EditorSurfaceHandle } from "./editor-surface.tsx";
import { type EditorDurableSession, EditorSyncStatus } from "./editor-sync-status.tsx";

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
}: {
  readonly service: LocalContentService;
  readonly itemId: Uuid;
  /** False when the device key is unavailable and nothing can be sealed. */
  readonly editingAllowed?: boolean;
  readonly items?: readonly ProjectedItem[];
  readonly onOpenPage?: (itemId: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void service.openOperationalPage(itemId).then((opened) => {
      if (cancelled) {
        if (opened.ok) opened.close();
        return;
      }
      if (opened.ok) {
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

  // Connectivity changes the honest status wording and drives resumption:
  // coming back online must flush pending work without waiting for a
  // keystroke (FR-027). A legacy branch schedules its own conversion from
  // inside the session queue, so only active pages need a nudge here.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const { mode, session, reconciler } = state;
    const goOnline = () => {
      session.setOnline(true);
      if (mode === "active") void reconciler.synchronize();
    };
    const goOffline = () => session.setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [state]);

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
