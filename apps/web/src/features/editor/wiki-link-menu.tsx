import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { WikiLinkCandidate } from "./wiki-link.ts";

export interface WikiLinkMenuHandle {
  readonly onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface WikiLinkMenuProps {
  readonly items: WikiLinkCandidate[];
  readonly command: (item: WikiLinkCandidate) => void;
}

export const WikiLinkMenu = forwardRef<WikiLinkMenuHandle, WikiLinkMenuProps>(function WikiLinkMenu(
  { items, command },
  ref,
) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filtered results reset selection
  useEffect(() => setSelectedIndex(0), [items]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: (event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          if (items.length > 0) {
            setSelectedIndex((index) =>
              event.key === "ArrowUp"
                ? (index + items.length - 1) % items.length
                : (index + 1) % items.length,
            );
          }
          return true;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const item = items[selectedIndex];
          if (item !== undefined) {
            command(item);
          }
          return true;
        }
        return false;
      },
    }),
    [command, items, selectedIndex],
  );

  return (
    <div className="wiki-link-menu" role="listbox" aria-label="Link to page">
      {items.length === 0 ? (
        <p className="wiki-link-empty" role="status">
          No matching pages
        </p>
      ) : (
        items.map((item, index) => (
          <button
            type="button"
            role="option"
            aria-selected={selectedIndex === index}
            className="wiki-link-option"
            key={item.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => command(item)}
          >
            <span>{item.name}</span>
            <small>Page</small>
          </button>
        ))
      )}
    </div>
  );
});
