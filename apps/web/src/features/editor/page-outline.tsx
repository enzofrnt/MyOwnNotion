import { type CSSProperties, type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FR_COPY } from "../../ui/copy/fr.ts";
import { editorScrollContainer } from "./editor-view-state.ts";
import {
  activeHeadingId,
  type HeadingsEditor,
  headingElement,
  scrollToPageHeading,
  usePageHeadings,
} from "./page-headings.ts";

export { activeHeadingId, collectPageHeadings, type PageHeading } from "./page-headings.ts";

const MIN_OUTLINE_WORKSPACE_WIDTH = 960;

export function PageOutline({
  editor,
  hostRef,
}: {
  readonly editor: HeadingsEditor;
  readonly hostRef: RefObject<HTMLElement | null>;
}) {
  const headings = usePageHeadings(editor);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hasRoom, setHasRoom] = useState(false);
  useEffect(() => {
    const host = hostRef.current;
    const scroller = host === null ? null : editorScrollContainer(host);
    if (host === null || scroller === null || headings.length < 2) {
      setActiveId(null);
      setHasRoom(false);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      setHasRoom(
        window.innerWidth > MIN_OUTLINE_WORKSPACE_WIDTH &&
          scroller.clientWidth > MIN_OUTLINE_WORKSPACE_WIDTH,
      );
      const positions = headings.flatMap((heading) => {
        const element = headingElement(host, heading.id);
        return element === null || element.getClientRects().length === 0
          ? []
          : [{ id: heading.id, top: element.getBoundingClientRect().top }];
      });
      const bottom =
        scroller.scrollTop > 0 &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      setActiveId(
        bottom
          ? (positions.at(-1)?.id ?? null)
          : activeHeadingId(positions, scroller.getBoundingClientRect().top + 96),
      );
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    resize.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [headings, hostRef]);
  if (headings.length < 2) return null;
  return createPortal(
    <nav
      className="page-outline"
      aria-label={FR_COPY.editor.outline.label}
      data-testid="page-outline"
      data-space-available={hasRoom ? "true" : "false"}
    >
      <ol className="page-outline__list">
        {headings.map((heading) => (
          <li
            key={heading.id}
            className="page-outline__item"
            data-active={heading.id === activeId ? "true" : "false"}
            style={{ "--outline-depth": String(heading.level - 1) } as CSSProperties}
          >
            <button
              type="button"
              className="page-outline__link"
              aria-current={heading.id === activeId ? "location" : undefined}
              onClick={() => {
                const host = hostRef.current;
                if (host !== null) scrollToPageHeading(host, heading.id);
              }}
            >
              <span className="page-outline__mark" aria-hidden="true" />
              <span className="page-outline__label">
                {heading.text || FR_COPY.editor.outline.emptyHeading}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>,
    document.body,
  );
}
