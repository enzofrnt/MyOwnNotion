import { type CSSProperties, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FR_COPY } from "../../ui/copy/fr.ts";

export interface PageHeading {
  readonly id: string;
  readonly level: 1 | 2 | 3 | 4;
  readonly text: string;
}

interface WalkableBlock {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly props?: { readonly level?: unknown };
  readonly content?: unknown;
  readonly children?: readonly WalkableBlock[];
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      if ("text" in part && typeof part.text === "string") return part.text;
      if ("content" in part) return inlineText(part.content);
      return "";
    })
    .join("");
}

export function collectPageHeadings(document: readonly unknown[]): PageHeading[] {
  const headings: PageHeading[] = [];
  const walk = (blocks: readonly unknown[]) => {
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) continue;
      const candidate = block as WalkableBlock;
      if (candidate.type === "heading" && typeof candidate.id === "string") {
        const level = candidate.props?.level;
        if (level === 1 || level === 2 || level === 3 || level === 4) {
          headings.push({
            id: candidate.id,
            level,
            text: inlineText(candidate.content).trim(),
          });
        }
      }
      if (Array.isArray(candidate.children)) walk(candidate.children);
    }
  };
  walk(document);
  return headings;
}

/** The last heading that has reached the reading line, otherwise the first. */
export function activeHeadingId(
  headings: readonly { readonly id: string; readonly top: number }[],
  threshold: number,
): string | null {
  let active: string | null = headings[0]?.id ?? null;
  for (const heading of headings) {
    if (heading.top <= threshold) active = heading.id;
  }
  return active;
}

interface OutlineEditor {
  readonly document: readonly unknown[];
  onChange(callback: () => void): () => void;
}

function headingElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.bn-block[data-id="${CSS.escape(id)}"]`);
}

export function PageOutline({ editor }: { readonly editor: OutlineEditor }) {
  const [headings, setHeadings] = useState(() => collectPageHeadings(editor.document));
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(
    () =>
      editor.onChange(() => {
        setHeadings(collectPageHeadings(editor.document));
      }),
    [editor],
  );

  useEffect(() => {
    if (headings.length < 2) return;
    const root = document.getElementById("workspace-main");
    if (root === null) return;
    const update = () => {
      const threshold = root.getBoundingClientRect().top + 48;
      const positions = headings.flatMap((heading) => {
        const element = headingElement(heading.id);
        return element === null
          ? []
          : [{ id: heading.id, top: element.getBoundingClientRect().top }];
      });
      setActiveId(activeHeadingId(positions, threshold));
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      root.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [headings]);

  if (headings.length < 2) return null;

  return createPortal(
    <nav
      className="page-outline"
      aria-label={FR_COPY.editor.outline.label}
      data-testid="page-outline"
    >
      <ol className="page-outline__list">
        {headings.map((heading) => {
          const label =
            heading.text.length > 0 ? heading.text : FR_COPY.editor.outline.emptyHeading;
          return (
            <li
              key={heading.id}
              className="page-outline__item"
              data-active={heading.id === activeId ? "true" : "false"}
              style={{ "--outline-depth": String(heading.level - 1) } as CSSProperties}
            >
              <button
                type="button"
                className="page-outline__link"
                onClick={() => {
                  headingElement(heading.id)?.scrollIntoView({
                    block: "start",
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "auto"
                      : "smooth",
                  });
                }}
              >
                <span className="page-outline__mark" aria-hidden="true" />
                <span className="page-outline__label">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>,
    document.body,
  );
}
