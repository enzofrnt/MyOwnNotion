import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ItemEmojiPicker } from "../../ui/emoji-picker.tsx";
import { AppIcon } from "../../ui/icons.tsx";
import { itemKindIconName } from "../../ui/item-icon.tsx";

const UNTITLED_PAGE = "Sans titre";
const TITLE_COMMIT_DELAY_MS = 450;
const KIND_CAPTION = {
  page: "Page",
  folder: "Dossier",
} as const;

function committedTitle(value: string): string {
  return value.trim() || UNTITLED_PAGE;
}

/**
 * The page identity is edited where it is read: as the first line of the page.
 *
 * A short debounce keeps ordinary typing calm while blur is an immediate
 * durability boundary. External updates never replace a focused draft, which
 * is the title equivalent of preserving the BlockNote cursor during a remote
 * page adoption.
 */
export function PageTitleEditor({
  breadcrumbs,
  initialDraft,
  icon,
  kind = "page",
  title,
  onCommit,
  onDraftStateChange,
  onIconChange,
  onMoveToContent,
  kindActions,
  pathActions,
  restoreFocus = false,
  discoverable = true,
}: {
  /** Location line rendered above the emoji, never emphasized (spec 022). */
  readonly breadcrumbs?: ReactNode;
  /** Quiet contextual controls sharing the location line (e.g. open the graph). */
  readonly pathActions?: ReactNode;
  /** Quiet create control on the kind caption row, pinned to the reading column’s end. */
  readonly kindActions?: ReactNode;
  /** Route-level draft retained across a transient surface replacement. */
  readonly initialDraft?: string;
  readonly icon?: string | null;
  readonly kind?: "page" | "folder";
  readonly title: string;
  readonly onCommit: (title: string) => Promise<void>;
  readonly onDraftStateChange?: (draft: string, focused: boolean) => void;
  readonly onIconChange?: (icon: string | null) => void;
  readonly onMoveToContent?: () => void;
  readonly restoreFocus?: boolean;
  /** False when this title belongs to a hidden keep-alive or graph-covered canvas. */
  readonly discoverable?: boolean;
}) {
  const startingDraft = initialDraft ?? (title || UNTITLED_PAGE);
  const [draft, setDraft] = useState(startingDraft);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const focused = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraft = useRef(draft);
  const lastRequested = useRef<string | null>(title || UNTITLED_PAGE);
  const pendingCommitCount = useRef(0);
  const onCommitRef = useRef(onCommit);
  const onDraftStateChangeRef = useRef(onDraftStateChange);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const autoFocusConsumed = useRef(false);
  const retainedDraftNeedsFirstProjectionSkip = useRef(initialDraft !== undefined);

  onCommitRef.current = onCommit;
  onDraftStateChangeRef.current = onDraftStateChange;

  const resize = useCallback((value: string) => {
    const element = textarea.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = value.length === 0 ? "1lh" : `${element.scrollHeight}px`;
  }, []);

  useEffect(() => {
    // A remounted editor starts from the route-level draft. Its first title
    // effect still sees the older durable projection, so consuming that effect
    // would immediately undo the continuity this remount is meant to provide.
    if (retainedDraftNeedsFirstProjectionSkip.current) {
      retainedDraftNeedsFirstProjectionSkip.current = false;
      return;
    }
    if (focused.current) return;
    const next = title || UNTITLED_PAGE;
    // A projection refresh may still carry the pre-edit title while the local
    // rename is being committed. Blur deliberately ends focus before that
    // asynchronous boundary, so focus alone cannot protect the acknowledged
    // draft from being reset to the stale value (most visible on WebKit).
    // The requested value itself is allowed through because it is the remote
    // acknowledgement that closes this race.
    if (pendingCommitCount.current > 0 && next !== lastRequested.current) return;
    lastRequested.current = next;
    latestDraft.current = next;
    if (textarea.current !== null) textarea.current.value = next;
    setDraft(next);
  }, [title]);

  useEffect(() => resize(draft), [draft, resize]);

  useEffect(() => {
    if (!restoreFocus || autoFocusConsumed.current) return;
    autoFocusConsumed.current = true;
    const element = textarea.current;
    element?.focus();
    const selection = latestDraft.current.length;
    element?.setSelectionRange(selection, selection);
    let cancelled = false;
    let frame: number | null = null;
    let attempts = 0;
    let remainedFocused = document.activeElement === element;
    const retainFocus = (): void => {
      if (cancelled) return;
      const current = textarea.current;
      if (current === null) return;
      if (document.activeElement === current) {
        if (remainedFocused) return;
        remainedFocused = true;
      } else {
        current.focus();
        const nextSelection = latestDraft.current.length;
        current.setSelectionRange(nextSelection, nextSelection);
        remainedFocused = false;
      }
      attempts += 1;
      if (attempts < 16 || document.activeElement === current) {
        frame = requestAnimationFrame(retainFocus);
      }
    };
    frame = requestAnimationFrame(retainFocus);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [restoreFocus]);

  const commit = useCallback((value: string, reflectInEditor = true) => {
    const next = committedTitle(value);
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    latestDraft.current = next;
    if (reflectInEditor && mounted.current) {
      if (textarea.current !== null) textarea.current.value = next;
      setDraft(next);
    }
    onDraftStateChangeRef.current?.(next, focused.current);
    if (next === lastRequested.current) return queue.current;
    lastRequested.current = next;
    if (mounted.current) {
      setBusy(true);
      setFailed(false);
    }
    pendingCommitCount.current += 1;
    const operation = async (): Promise<void> => {
      try {
        await onCommitRef.current(next);
        if (mounted.current) setFailed(false);
      } catch (error) {
        // A failed title stays retryable on the next blur instead of being
        // mistaken for an acknowledged remote value.
        if (lastRequested.current === next) lastRequested.current = null;
        if (mounted.current) setFailed(true);
        throw error;
      } finally {
        pendingCommitCount.current -= 1;
        if (mounted.current) setBusy(false);
      }
    };
    const pending = queue.current.then(operation, operation);
    queue.current = pending.catch(() => undefined);
    return pending;
  }, []);

  const scheduleCommit = useCallback(
    (value: string) => {
      if (timer.current !== null) clearTimeout(timer.current);
      // An empty title is a valid focused draft. Its display fallback is a
      // validation boundary, not an autosave value that may race the next key.
      if (value.trim().length === 0) {
        timer.current = null;
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        void commit(value).catch(() => undefined);
      }, TITLE_COMMIT_DELAY_MS);
    },
    [commit],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      const pending = committedTitle(latestDraft.current);
      if (pending !== lastRequested.current) void commit(pending, false).catch(() => undefined);
    };
  }, [commit]);

  return (
    <div className="workspace-page-title" data-kind={kind}>
      {breadcrumbs === undefined && pathActions === undefined ? null : (
        <div className="workspace-page-title__path">
          <div className="workspace-page-title__path-crumbs">{breadcrumbs}</div>
          {pathActions === undefined ? null : (
            <div className="workspace-page-title__path-actions" data-testid="page-context-actions">
              {pathActions}
            </div>
          )}
        </div>
      )}
      <div className="workspace-page-title__body">
        {onIconChange === undefined ? null : (
          <ItemEmojiPicker
            kind={kind}
            label={title || UNTITLED_PAGE}
            value={icon ?? null}
            variant="page"
            onChange={onIconChange}
          />
        )}
        <textarea
          ref={textarea}
          rows={1}
          // Keep the browser's live value authoritative while the owner types.
          // A controlled textarea lets an unrelated concurrent render project
          // the previous React state back into the DOM between WebKit's native
          // replacement and its input event. `defaultValue` initializes each
          // route-bound editor; acknowledged remote changes are projected
          // explicitly by the title effect above.
          defaultValue={startingDraft}
          aria-label={kind === "folder" ? "Nom du dossier" : "Titre de la page"}
          aria-invalid={failed || undefined}
          aria-busy={busy || undefined}
          data-testid={discoverable ? "active-item-title" : undefined}
          placeholder={UNTITLED_PAGE}
          spellCheck
          onFocus={() => {
            focused.current = true;
            onDraftStateChangeRef.current?.(latestDraft.current, true);
          }}
          // `input` is the browser event produced by typing, paste and
          // Playwright's fill primitive. Reading it directly avoids WebKit's
          // synthetic change-value tracking window while a newly-created page
          // finishes replacing its loading surface.
          onInput={(event) => {
            const next = event.currentTarget.value;
            latestDraft.current = next;
            setDraft(next);
            onDraftStateChangeRef.current?.(next, true);
            scheduleCommit(next);
          }}
          onBlur={(event) => {
            focused.current = false;
            void commit(event.currentTarget.value).catch(() => undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.blur();
              onMoveToContent?.();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              const restored = title || UNTITLED_PAGE;
              latestDraft.current = restored;
              event.currentTarget.value = restored;
              setDraft(restored);
              onDraftStateChangeRef.current?.(restored, false);
              event.currentTarget.blur();
            }
          }}
        />
        <div className="workspace-page-title__meta">
          <span className="workspace-page-title__kind" data-testid="active-item-kind">
            <AppIcon name={itemKindIconName(kind)} size="small" />
            {KIND_CAPTION[kind]}
          </span>
          {kindActions === undefined ? null : (
            <div className="workspace-page-title__kind-actions">{kindActions}</div>
          )}
        </div>
      </div>
    </div>
  );
}
