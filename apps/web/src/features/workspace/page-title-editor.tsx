import { useCallback, useEffect, useRef, useState } from "react";

const UNTITLED_PAGE = "Sans titre";
const TITLE_COMMIT_DELAY_MS = 450;

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
  title,
  onCommit,
  onMoveToContent,
}: {
  readonly title: string;
  readonly onCommit: (title: string) => Promise<void>;
  readonly onMoveToContent?: () => void;
}) {
  const [draft, setDraft] = useState(title || UNTITLED_PAGE);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const focused = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraft = useRef(draft);
  const lastRequested = useRef<string | null>(title || UNTITLED_PAGE);
  const onCommitRef = useRef(onCommit);
  const queue = useRef<Promise<void>>(Promise.resolve());

  onCommitRef.current = onCommit;

  const resize = useCallback((value: string) => {
    const element = textarea.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = value.length === 0 ? "1lh" : `${element.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (focused.current) return;
    const next = title || UNTITLED_PAGE;
    lastRequested.current = next;
    latestDraft.current = next;
    setDraft(next);
  }, [title]);

  useEffect(() => resize(draft), [draft, resize]);

  const commit = useCallback((value: string, reflectInEditor = true) => {
    const next = committedTitle(value);
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    latestDraft.current = next;
    if (reflectInEditor && mounted.current) setDraft(next);
    if (next === lastRequested.current) return queue.current;
    lastRequested.current = next;
    if (mounted.current) {
      setBusy(true);
      setFailed(false);
    }
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
    <div className="workspace-page-title">
      <textarea
        ref={textarea}
        rows={1}
        value={draft}
        aria-label="Titre de la page"
        aria-invalid={failed || undefined}
        aria-busy={busy || undefined}
        data-testid="active-item-title"
        placeholder={UNTITLED_PAGE}
        spellCheck
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          latestDraft.current = event.target.value;
          setDraft(event.target.value);
          scheduleCommit(event.target.value);
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
            setDraft(restored);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
