/** Accessible picker for inserting an internal page reference. */
import type { ProjectedItem } from "@myownnotion/client-core";
import type { Editor } from "@tiptap/react";
import { useMemo, useState } from "react";

export function PageLinkControl({
  editor,
  currentItemId,
  items,
}: {
  readonly editor: Editor;
  readonly currentItemId: string;
  readonly items: readonly ProjectedItem[];
}) {
  const [targetId, setTargetId] = useState("");
  const [label, setLabel] = useState("");
  const candidates = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.id !== currentItemId &&
            item.lifecycle === "active" &&
            (item.kind === "page" || item.kind === "folder"),
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [items, currentItemId],
  );

  const insert = (): void => {
    const target = candidates.find((item) => item.id === targetId);
    if (target === undefined) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: "text",
        text: label.trim() || target.name,
        marks: [{ type: "pageLink", attrs: { targetItemId: target.id } }],
      })
      .run();
    setLabel("");
  };

  return (
    <fieldset className="page-link-control">
      <legend>Insert internal page link</legend>
      <label htmlFor="page-link-target">Page link target</label>
      <select
        id="page-link-target"
        value={targetId}
        onChange={(event) => setTargetId(event.target.value)}
        aria-label="Page link target"
      >
        <option value="">Choose a page…</option>
        {candidates.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} ({item.kind})
          </option>
        ))}
      </select>
      <label htmlFor="page-link-label">Link text</label>
      <input
        id="page-link-label"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Optional label"
        aria-label="Internal link text"
      />
      <button type="button" onClick={insert} disabled={targetId === ""}>
        Insert page link
      </button>
    </fieldset>
  );
}
