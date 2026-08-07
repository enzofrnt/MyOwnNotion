import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SlashCommandItem } from "./slash-command.ts";

export interface SlashCommandMenuHandle {
  readonly onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface SlashCommandMenuProps {
  readonly items: SlashCommandItem[];
  readonly command: (item: SlashCommandItem) => void;
}

export const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, SlashCommandMenuProps>(
  function SlashCommandMenu({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    // biome-ignore lint/correctness/useExhaustiveDependencies: a new filtered list resets keyboard selection
    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: (event) => {
          if (items.length === 0) {
            return false;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((index) => (index + items.length - 1) % items.length);
            return true;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((index) => (index + 1) % items.length);
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
      <div className="slash-command-menu" role="listbox" aria-label="Insert block">
        {items.length === 0 ? (
          <p className="slash-command-empty" role="status">
            No matching blocks
          </p>
        ) : (
          items.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className="slash-command-option"
              key={item.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command(item)}
            >
              <span>{item.label}</span>
              <small>{item.description}</small>
            </button>
          ))
        )}
      </div>
    );
  },
);
