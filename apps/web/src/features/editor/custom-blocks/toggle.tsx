import { defaultBlockSpecs } from "@blocknote/core";
import {
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
  useEditorState,
} from "@blocknote/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";

const communityToggle = defaultBlockSpecs.toggleListItem;
type ToggleConfig = typeof communityToggle.config;

function storedExpanded(blockId: string): boolean {
  try {
    return window.localStorage.getItem(`toggle-${blockId}`) === "true";
  } catch {
    return false;
  }
}

function persistExpanded(blockId: string, expanded: boolean): void {
  try {
    window.localStorage.setItem(`toggle-${blockId}`, expanded ? "true" : "false");
  } catch {
    // A private or full storage area must not make a purely presentational
    // disclosure unusable. The state simply lasts for this mount instead.
  }
}

export function ToggleDisclosure({
  expanded,
  onToggle,
}: {
  readonly expanded: boolean;
  readonly onToggle: (expanded: boolean) => void;
}) {
  return (
    <button
      className="bn-toggle-button"
      type="button"
      aria-expanded={expanded}
      aria-label={
        expanded
          ? FR_COPY.editor.richBlocks.toggle.collapse
          : FR_COPY.editor.richBlocks.toggle.expand
      }
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onToggle(!expanded)}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        height="1em"
        viewBox="0 -960 960 960"
        width="1em"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M472-480 332-620q-18-18-18-44t18-44q18-18 44-18t44 18l183 183q9 9 14 21t5 24q0 12-5 24t-14 21L420-252q-18 18-44 18t-44-18q-18-18-18-44t18-44l140-140Z" />
      </svg>
    </button>
  );
}

function AccessibleToggleBlock({
  block,
  editor,
  contentRef,
}: ReactCustomBlockRenderProps<ToggleConfig>) {
  const [expanded, setExpanded] = useState(() => storedExpanded(block.id));
  const childCount = useEditorState({
    editor,
    selector: ({ editor: current }) => current.getBlock(block.id)?.children.length ?? 0,
  });
  const previousChildCount = useRef(childCount);
  const setExpandedPersistently = useCallback(
    (next: boolean) => {
      persistExpanded(block.id, next);
      setExpanded(next);
    },
    [block.id],
  );

  useEffect(() => {
    if (childCount > previousChildCount.current && !expanded) {
      setExpandedPersistently(true);
    } else if (childCount === 0 && previousChildCount.current > 0 && expanded) {
      setExpandedPersistently(false);
    }
    previousChildCount.current = childCount;
  }, [childCount, expanded, setExpandedPersistently]);

  const addChild = (): void => {
    editor.transact(() => {
      const current = editor.getBlock(block.id);
      if (current === undefined) return;
      const updated = editor.updateBlock(current, { children: [{}] });
      const firstChild = updated.children[0];
      if (firstChild !== undefined) editor.setTextCursorPosition(firstChild.id, "end");
      editor.focus();
    });
  };

  return (
    <div>
      <div className="bn-toggle-wrapper" data-show-children={expanded}>
        <ToggleDisclosure expanded={expanded} onToggle={setExpandedPersistently} />
        <p className="editor-toggle-content" ref={contentRef} />
      </div>
      {editor.isEditable && expanded && childCount === 0 ? (
        <button
          className="bn-toggle-add-block-button"
          type="button"
          contentEditable={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={addChild}
        >
          {FR_COPY.editor.richBlocks.toggle.addChild}
        </button>
      ) : null}
    </div>
  );
}

/**
 * BlockNote Community supplies the canonical parser and list keyboard
 * extension. MyOwnNotion replaces only its visual wrapper because the
 * Community button does not expose `aria-expanded` or an accessible name.
 */
export const toggleBlockSpec = createReactBlockSpec(
  communityToggle.config,
  {
    ...communityToggle.implementation,
    render: AccessibleToggleBlock,
    toExternalHTML: ({ contentRef }) => (
      <details open>
        <summary>
          <p ref={contentRef} />
        </summary>
      </details>
    ),
  },
  communityToggle.extensions,
)();
