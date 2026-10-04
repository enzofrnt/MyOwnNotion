/** Read the first text line; never include heading spacing or later wrapped lines. */
export function blockTextSideMenuOffset(
  reference: Element,
  menuHeight: number,
): number | undefined {
  const inline = reference.querySelector<HTMLElement>(".bn-inline-content");
  if (inline === null) return undefined;

  const document = inline.ownerDocument;
  const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const start = text.search(/\S/u);
    if (start === -1) continue;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + ((text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1));
    const line = range.getBoundingClientRect();
    if (line.height > 0) {
      return line.top + line.height / 2 - reference.getBoundingClientRect().top - menuHeight / 2;
    }
  }

  // Empty text still has a line box. Its min-height can exceed that first line.
  const rect = inline.getBoundingClientRect();
  if (rect.height === 0) return undefined;
  const style = document.defaultView?.getComputedStyle(inline);
  const lineHeight = Number.parseFloat(style?.lineHeight ?? "");
  if (!Number.isFinite(lineHeight)) return undefined;
  return rect.top + lineHeight / 2 - reference.getBoundingClientRect().top - menuHeight / 2;
}
