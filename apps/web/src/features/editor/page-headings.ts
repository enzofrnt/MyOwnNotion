import { useEffect, useRef, useState } from "react";
import { editorScrollContainer } from "./editor-view-state.ts";

export interface PageHeading {
  readonly id: string;
  readonly level: 1 | 2 | 3 | 4;
  readonly text: string;
}
export interface HeadingsEditor {
  readonly document: readonly unknown[];
  onChange(callback: () => void): () => void;
}
interface WalkableBlock {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly level?: unknown;
  readonly props?: { readonly level?: unknown };
  readonly content?: unknown;
  readonly children?: readonly unknown[];
}
function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      if ("text" in part && typeof part.text === "string") return part.text;
      if (
        "type" in part &&
        part.type === "inlineEquation" &&
        "props" in part &&
        typeof part.props === "object" &&
        part.props !== null &&
        "expression" in part.props
      )
        return String(part.props.expression);
      return "content" in part ? inlineText(part.content) : "";
    })
    .join("");
}
export function collectPageHeadings(document: readonly unknown[]): PageHeading[] {
  const headings: PageHeading[] = [];
  const walk = (blocks: readonly unknown[]) => {
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) continue;
      const candidate = block as WalkableBlock;
      const level = candidate.props?.level ?? candidate.level;
      if (
        candidate.type === "heading" &&
        typeof candidate.id === "string" &&
        (level === 1 || level === 2 || level === 3 || level === 4)
      )
        headings.push({ id: candidate.id, level, text: inlineText(candidate.content).trim() });
      if (Array.isArray(candidate.children)) walk(candidate.children);
    }
  };
  walk(document);
  return headings;
}
export function usePageHeadings(editor: HeadingsEditor): PageHeading[] {
  const [headings, setHeadings] = useState(() => collectPageHeadings(editor.document));
  const published = useRef(headings);
  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      const next = collectPageHeadings(editor.document);
      if (
        next.length === published.current.length &&
        next.every((heading, index) => {
          const previous = published.current[index];
          return (
            heading.id === previous?.id &&
            heading.level === previous.level &&
            heading.text === previous.text
          );
        })
      )
        return;
      published.current = next;
      setHeadings(next);
    };
    update();
    // BlockNote emits inside its transaction, before the durable adapter's
    // listener. React work there can interrupt the remaining listeners (error
    // #185 during rapid typing). The outline is a derived UI projection: read
    // the latest titles once per frame, after every transaction was recorded.
    const unsubscribe = editor.onChange(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        update();
      });
    });
    return () => {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [editor]);
  return headings;
}
/** The last visible heading which reached the reading line, otherwise the first. */
export function activeHeadingId(
  headings: readonly { readonly id: string; readonly top: number }[],
  threshold: number,
): string | null {
  let active = headings[0]?.id ?? null;
  for (const heading of headings) if (heading.top <= threshold) active = heading.id;
  return active;
}
export function headingElement(host: ParentNode, id: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(id)}"]`);
}
/** Open disclosure ancestors as UI state, then scroll within this editor's workspace. */
export function scrollToPageHeading(host: ParentNode, id: string): void {
  const target = headingElement(host, id);
  if (target === null) return;
  const ancestors: HTMLElement[] = [];
  let ancestor = target.parentElement?.closest<HTMLElement>(".bn-block-outer") ?? null;
  while (ancestor !== null) {
    ancestors.unshift(ancestor);
    ancestor = ancestor.parentElement?.closest<HTMLElement>(".bn-block-outer") ?? null;
  }
  for (const parent of ancestors) {
    parent
      .querySelector<HTMLButtonElement>(
        ':scope > .bn-block .bn-toggle-wrapper > .bn-toggle-button[aria-expanded="false"]',
      )
      ?.click();
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const current = headingElement(host, id);
      if (current === null) return;
      const scroller = editorScrollContainer(current);
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      if (scroller === null) {
        current.scrollIntoView({ block: "start", behavior });
        return;
      }
      const top =
        current.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        48;
      scroller.scrollTo({ top: Math.max(0, top), behavior });
    }),
  );
}
