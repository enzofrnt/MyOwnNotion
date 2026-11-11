import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { NativeInput } from "../../ui/primitives/index.ts";

export interface NavigationInlineRenameProps {
  /** Persisted name; an unchanged draft closes without a mutation. */
  readonly committedName: string;
  readonly itemName: string;
  /** Draft to resume, e.g. the name a refused write could not save. */
  readonly initialDraft?: string;
  /** Persists the trimmed name. Resolves false when the write was refused. */
  readonly onCommit: (name: string) => Promise<boolean>;
  /**
   * Closes the editor. `focusRow` is true for the keyboard paths (Enter, Échap)
   * so focus returns to the tree row instead of being lost with the input.
   */
  readonly onClose: (focusRow: boolean) => void;
}

/**
 * The tree row's own rename field, where Notion puts it.
 *
 * A native `window.prompt` was used here before. It hides the context, cannot
 * be styled or translated, and browsers can suppress dialogs altogether: with
 * "prevent this page from creating additional dialogs" ticked, `prompt()`
 * returns `null` immediately and the rename silently did nothing. Editing the
 * row itself has no such failure mode, keeps the item visible while its name
 * changes, and matches the page title's inline editing.
 *
 * Enter commits, Échap restores the previous name, leaving the field commits
 * like Notion. A refused write keeps the draft and the field open so the owner
 * can retry without retyping.
 */
export function NavigationInlineRename({
  committedName,
  initialDraft,
  itemName,
  onClose,
  onCommit,
}: NavigationInlineRenameProps) {
  const [value, setValue] = useState(initialDraft ?? committedName);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const settled = useRef(false);
  const committed = committedName.trim();

  useEffect(() => {
    const element = input.current;
    if (element === null) return;
    element.focus();
    element.select();
  }, []);

  const close = (focusRow: boolean): void => {
    if (settled.current) return;
    settled.current = true;
    onClose(focusRow);
  };

  const commit = async (focusRow: boolean): Promise<void> => {
    if (settled.current) return;
    const next = value.trim();
    if (next.length === 0 || next === committed) {
      close(focusRow);
      return;
    }
    settled.current = true;
    setBusy(true);
    const accepted = await onCommit(next);
    if (accepted) {
      onClose(focusRow);
      return;
    }
    // Refused (stale revision, offline): stay open with the draft intact.
    settled.current = false;
    if (focusRow) input.current?.focus();
    setBusy(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void commit(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  return (
    <span className="tree-inline-rename" data-no-tree-drag>
      <NativeInput
        ref={input}
        className="tree-inline-rename__input"
        density="compact"
        type="text"
        value={value}
        maxLength={512}
        readOnly={busy}
        aria-busy={busy || undefined}
        aria-label={`Renommer ${itemName}`}
        data-testid={`rename-input-${itemName}`}
        onBlur={() => void commit(false)}
        onChange={(event) => setValue(event.currentTarget.value)}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      />
    </span>
  );
}
